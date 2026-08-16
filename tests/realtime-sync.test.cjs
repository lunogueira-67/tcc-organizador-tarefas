const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completedRowsFromLegacy,
  isValidConfig,
  stateFromRows
} = require('../realtime-sync.js');

test('aceita somente configuracao publica completa e habilitada', () => {
  assert.equal(isValidConfig({ enabled: false }), false);
  assert.equal(isValidConfig({
    enabled: true,
    projectUrl: 'https://abc123.supabase.co',
    publishableKey: 'sb_publishable_example123',
    boardSlug: 'tcc-fraude-pix'
  }), true);
  assert.equal(isValidConfig({
    enabled: true,
    projectUrl: 'http://abc123.supabase.co',
    publishableKey: 'service_role_secret',
    boardSlug: 'tcc-fraude-pix'
  }), false);
});

test('converte linhas do banco em estado local booleano', () => {
  assert.deepEqual(stateFromRows([
    { task_id: 'm1_p1_1', completed: true },
    { task_id: 'm1_p2_1', completed: false },
    { task_id: '<script>', completed: true }
  ]), {
    m1_p1_1: true,
    m1_p2_1: false
  });
});

test('migra apenas tarefas concluidas de um link antigo', () => {
  assert.deepEqual(completedRowsFromLegacy({
    m1_p1_1: true,
    m1_p2_1: false,
    '../invalida': true
  }, 'board-id', 'user-id'), [{
    board_id: 'board-id',
    task_id: 'm1_p1_1',
    completed: true,
    updated_by: 'user-id'
  }]);
});
