# Sincronização do cronograma em tempo real

O organizador de tarefas é um projeto independente hospedado no GitHub Pages. O estado compartilhado fica em um projeto Supabase dedicado e a interface nunca recebe uma chave administrativa.

## Como funciona

1. Lucas ou Letícia abre o organizador publicado.
2. A pessoa informa um e-mail autorizado e recebe um link mágico de acesso.
3. Cada clique grava apenas a tarefa alterada em `tcc_task_progress`.
4. O Supabase Realtime envia a alteração ao outro navegador.
5. O indicador da página mostra `ao vivo`, `conectando` ou `reconectando`.

O navegador mantém uma cópia local somente para carregamento rápido. Depois do login, o banco é a fonte oficial do progresso.

## Segurança

- O frontend usa apenas uma chave `sb_publishable_...`, que é pública por definição.
- Chaves `secret` e `service_role` nunca podem ser adicionadas a `realtime-config.js`.
- Todas as tabelas públicas têm Row Level Security (RLS).
- Somente e-mails cadastrados em `tcc_board_members` podem ler ou alterar o quadro.
- Visitantes não autenticados não recebem permissão de leitura ou escrita.
- O banco substitui `updated_by` e `updated_at` em cada alteração, evitando auditoria forjada pelo navegador.

## Arquivos

- `realtime-config.js`: URL, chave pública e identificador do quadro.
- `realtime-sync.js`: acesso ao banco e assinatura do canal em tempo real.
- `supabase/schema.sql`: tabelas, políticas RLS, gatilhos e publicação Realtime.
- `tests/realtime-sync.test.cjs`: testes da configuração, estado remoto e migração de links antigos.

## Configuração aplicada

1. Projeto Supabase dedicado criado na região `sa-east-1`.
2. `supabase/schema.sql` aplicado como migração.
3. Lucas e Letícia cadastrados em `tcc_board_members` com e-mails minúsculos.
4. A configuração pública do projeto foi adicionada a `realtime-config.js` e a sincronização foi habilitada.
5. O endereço de produção é `https://lunogueira-67.github.io/tcc-organizador-tarefas/`.
6. Em Auth > URL Configuration, o mesmo endereço deve ser usado como Site URL e Redirect URL.

Exemplo administrativo para cadastrar os membros depois da criação do quadro:

```sql
insert into public.tcc_board_members (board_id, email, display_name, role)
select id, lower('EMAIL_DA_LETICIA'), 'Letícia', 'member'
from public.tcc_boards
where slug = 'tcc-organizador-tarefas';

insert into public.tcc_board_members (board_id, email, display_name, role)
select id, lower('EMAIL_DO_LUCAS'), 'Lucas', 'owner'
from public.tcc_boards
where slug = 'tcc-organizador-tarefas';
```

## Compatibilidade com o link antigo

Links que contêm `#p=...` ainda são reconhecidos. Depois que uma pessoa autorizada entra, as tarefas concluídas desse link são inseridas apenas quando ainda não existem no banco. Assim, o histórico compartilhado existente não é sobrescrito.

## Comportamento em falhas

- Se o projeto Supabase estiver pausado/inativo, reative-o pelo painel antes de testar o acesso. O GitHub Pages pode continuar funcionando mesmo com o backend indisponível.
- A autorização em `tcc_board_members` controla o quadro, não a entrega de e-mails. O remetente padrão do Supabase só entrega para membros da equipe administrativa da organização e possui limite reduzido. Para enviar a Lucas e Letícia sem dar acesso administrativo ao projeto, configure SMTP próprio em Authentication > Email > SMTP Settings. Consulte a [documentação oficial](https://supabase.com/docs/guides/auth/auth-smtp).
- Não adicione Letícia à equipe administrativa somente para contornar a restrição de entrega. Preserve a separação entre acesso ao quadro e administração do serviço.
- O painel mantém visível o diagnóstico de falha de envio: destinatário bloqueado, limite de pedidos, serviço indisponível ou link expirado. Um pedido aceito não comprova recebimento na caixa de entrada.
- Ao validar a configuração, use o e-mail já cadastrado no quadro e o link mais recente. Nunca compartilhe links de autenticação ou tokens no GitHub.

- Sem login, cliques são bloqueados no modo compartilhado.
- Se uma gravação falhar, a página recarrega o estado oficial do banco.
- Se somente o WebSocket cair, as gravações continuam no banco e o indicador mostra que o canal está reconectando.
- Ao voltar para a aba ou recuperar a internet, a página busca novamente o estado oficial.
