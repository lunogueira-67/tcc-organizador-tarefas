# Organizador de tarefas do TCC

Quadro independente para Lucas e Letícia acompanharem o cronograma do TCC sobre detecção de fraudes em transações Pix.

Este repositório não contém código do modelo, dataset, monografia ou artefatos acadêmicos. Ele serve somente para organizar tarefas e exibir o andamento compartilhado.

## Recursos

- Cronograma mensal de maio a outubro de 2026.
- Progresso geral e por mês.
- Responsabilidades separadas por pessoa e tarefas em conjunto.
- Login sem senha por link mágico.
- Atualização em tempo real entre dois navegadores.
- Cache local, reconexão e indicador do estado da sincronização.
- Acesso ao banco restrito aos dois e-mails cadastrados por RLS.

## Executar localmente

Abra um terminal nesta pasta e execute:

```powershell
python -m http.server 8000
```

Depois acesse `http://127.0.0.1:8000/`.

A versão publicada usa um banco Supabase dedicado. Sem uma sessão autorizada, o quadro fica visível, mas as alterações compartilhadas permanecem bloqueadas.

## Testes

```powershell
node --test tests/*.test.cjs
```

## Sincronização

Consulte [SINCRONIZACAO_TEMPO_REAL.md](./SINCRONIZACAO_TEMPO_REAL.md). Nunca coloque chaves `secret` ou `service_role` no frontend.
