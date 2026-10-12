(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.TccRealtimeSync = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TASK_ID_PATTERN = /^[a-z0-9_]{3,64}$/;

  function accessLinkErrorMessage(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    if (code === 'email_address_not_authorized' || message.includes('email address not authorized')) {
      return 'O serviço de e-mail bloqueou este destinatário. O responsável pelo organizador precisa configurar um remetente SMTP próprio no Supabase. Repetir o pedido não libera o envio.';
    }
    if (error?.status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
      return 'O limite de envio de links foi atingido. Aguarde antes de tentar novamente; novos cliques não antecipam a liberação.';
    }
    if (code === 'otp_expired') {
      return 'O link de acesso expirou ou já foi utilizado. Solicite outro link e abra somente o e-mail mais recente.';
    }
    if (code === 'email_provider_disabled' || code === 'signup_disabled' || code === 'otp_disabled') {
      return 'O acesso por e-mail está desativado no serviço. O responsável precisa revisar a configuração de autenticação do organizador.';
    }
    if (code === 'email_address_invalid' || code === 'validation_failed') {
      return 'Confira o endereço de e-mail informado e tente novamente.';
    }
    if (Number(error?.status) >= 500 || code === 'request_timeout' || code === 'unexpected_failure' || code === 'email_send_failed') {
      return 'O serviço de acesso está indisponível ou falhou ao enviar o e-mail. O responsável precisa verificar se o projeto Supabase está ativo e se o remetente de e-mails funciona.';
    }
    return 'Não foi possível solicitar o link. Confira sua conexão e tente novamente; se persistir, informe o erro ao responsável pelo organizador.';
  }

  function isValidConfig(config) {
    if (!config || config.enabled !== true) return false;

    const url = String(config.projectUrl || '').trim();
    const key = String(config.publishableKey || '').trim();
    const slug = String(config.boardSlug || '').trim();

    return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)
      && /^(sb_publishable_|eyJ)[A-Za-z0-9._-]+$/.test(key)
      && /^[a-z0-9-]{3,80}$/.test(slug);
  }

  function stateFromRows(rows) {
    return (rows || []).reduce((state, row) => {
      if (row && TASK_ID_PATTERN.test(String(row.task_id || ''))) {
        state[row.task_id] = row.completed === true;
      }
      return state;
    }, {});
  }

  function completedRowsFromLegacy(state, boardId, userId) {
    return Object.entries(state || {})
      .filter(([taskId, completed]) => TASK_ID_PATTERN.test(taskId) && completed === true)
      .map(([taskId]) => ({
        board_id: boardId,
        task_id: taskId,
        completed: true,
        updated_by: userId
      }));
  }

  function createAccessError() {
    const error = new Error('Este e-mail nao esta autorizado a acessar o cronograma compartilhado.');
    error.code = 'TCC_ACCESS_DENIED';
    return error;
  }

  class RealtimeBoard {
    constructor(options) {
      if (!options || !options.client || !options.boardSlug) {
        throw new Error('Cliente Supabase e boardSlug sao obrigatorios.');
      }

      this.client = options.client;
      this.boardSlug = options.boardSlug;
      this.onSnapshot = options.onSnapshot || function () {};
      this.onTaskChange = options.onTaskChange || function () {};
      this.onNamesChange = options.onNamesChange || function () {};
      this.onStatus = options.onStatus || function () {};
      this.session = null;
      this.board = null;
      this.channel = null;
    }

    emitStatus(kind, message) {
      this.onStatus({ kind, message });
    }

    async connect(session, initialData) {
      await this.disconnect();
      this.session = session;
      this.emitStatus('connecting', 'Conectando ao cronograma compartilhado...');

      const { data: board, error } = await this.client
        .from('tcc_boards')
        .select('id, slug, title')
        .eq('slug', this.boardSlug)
        .maybeSingle();

      if (error) throw error;
      if (!board) throw createAccessError();

      this.board = board;
      await this.seedInitialData(initialData || {});

      const subscribed = await this.subscribe();
      await this.reload();

      if (subscribed) {
        this.emitStatus('live', 'Sincronizacao em tempo real ativa.');
      } else {
        this.emitStatus('degraded', 'Dados salvos, mas o canal ao vivo esta reconectando.');
      }

      return { board, subscribed };
    }

    async seedInitialData(initialData) {
      const userId = this.session.user.id;
      const names = initialData.names || {};
      const legacyRows = completedRowsFromLegacy(initialData.legacyState, this.board.id, userId);

      const operations = [];

      if (names.person1 && names.person2) {
        operations.push(
          this.client
            .from('tcc_board_settings')
            .upsert({
              board_id: this.board.id,
              person1_name: names.person1,
              person2_name: names.person2,
              updated_by: userId
            }, { onConflict: 'board_id', ignoreDuplicates: true })
        );
      }

      if (legacyRows.length > 0) {
        operations.push(
          this.client
            .from('tcc_task_progress')
            .upsert(legacyRows, {
              onConflict: 'board_id,task_id',
              ignoreDuplicates: true
            })
        );
      }

      const results = await Promise.all(operations);
      const failed = results.find((result) => result.error);
      if (failed) throw failed.error;
    }

    async subscribe() {
      const boardId = this.board.id;

      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(value);
        };

        const timeoutId = setTimeout(() => finish(false), 12000);

        this.channel = this.client
          .channel(`tcc-board:${boardId}:progress`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'tcc_task_progress',
            filter: `board_id=eq.${boardId}`
          }, (payload) => {
            if (payload.new && payload.new.board_id === boardId) {
              this.onTaskChange(payload.new, 'realtime');
            }
          })
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'tcc_board_settings',
            filter: `board_id=eq.${boardId}`
          }, (payload) => {
            if (payload.new && payload.new.board_id === boardId) {
              this.onNamesChange(payload.new, 'realtime');
            }
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              this.emitStatus('live', 'Sincronizacao em tempo real ativa.');
              finish(true);
              return;
            }

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              this.emitStatus('degraded', 'Canal ao vivo indisponivel; tentando reconectar.');
              finish(false);
            } else if (status === 'CLOSED' && this.session) {
              this.emitStatus('degraded', 'Canal ao vivo desconectado; tentando reconectar.');
            }
          });
      });
    }

    async reload() {
      if (!this.board) return;

      const [tasksResult, settingsResult] = await Promise.all([
        this.client
          .from('tcc_task_progress')
          .select('task_id, completed, updated_by, updated_at')
          .eq('board_id', this.board.id),
        this.client
          .from('tcc_board_settings')
          .select('person1_name, person2_name, updated_by, updated_at')
          .eq('board_id', this.board.id)
          .maybeSingle()
      ]);

      if (tasksResult.error) throw tasksResult.error;
      if (settingsResult.error) throw settingsResult.error;

      this.onSnapshot({
        board: this.board,
        state: stateFromRows(tasksResult.data),
        names: settingsResult.data || null
      });
    }

    async setTask(taskId, completed) {
      if (!this.board || !this.session) throw new Error('Sincronizacao ainda nao esta pronta.');
      if (!TASK_ID_PATTERN.test(taskId)) throw new Error('Identificador de tarefa invalido.');

      const { data, error } = await this.client
        .from('tcc_task_progress')
        .upsert({
          board_id: this.board.id,
          task_id: taskId,
          completed: completed === true,
          updated_by: this.session.user.id
        }, { onConflict: 'board_id,task_id' })
        .select('task_id, completed, updated_by, updated_at')
        .single();

      if (error) throw error;
      this.onTaskChange(data, 'write');
      return data;
    }

    async setNames(person1, person2) {
      if (!this.board || !this.session) throw new Error('Sincronizacao ainda nao esta pronta.');

      const { data, error } = await this.client
        .from('tcc_board_settings')
        .upsert({
          board_id: this.board.id,
          person1_name: String(person1 || '').trim().slice(0, 80),
          person2_name: String(person2 || '').trim().slice(0, 80),
          updated_by: this.session.user.id
        }, { onConflict: 'board_id' })
        .select('person1_name, person2_name, updated_by, updated_at')
        .single();

      if (error) throw error;
      this.onNamesChange(data, 'write');
      return data;
    }

    async disconnect() {
      if (this.channel) {
        await this.client.removeChannel(this.channel);
      }
      this.channel = null;
      this.board = null;
      this.session = null;
    }
  }

  return {
    RealtimeBoard,
    accessLinkErrorMessage,
    completedRowsFromLegacy,
    isValidConfig,
    stateFromRows
  };
});
