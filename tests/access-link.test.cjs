const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { accessLinkErrorMessage } = require('../realtime-sync.js');

test('explica bloqueio do remetente padrao sem prometer entrega', () => {
  assert.match(accessLinkErrorMessage({ code: 'email_address_not_authorized', status: 403 }), /SMTP/);
});

test('distingue indisponibilidade, limite e link vencido', () => {
  assert.match(accessLinkErrorMessage({ status: 502 }), /indisponível/);
  assert.match(accessLinkErrorMessage({ code: 'over_email_send_rate_limit', status: 429 }), /limite/i);
  assert.match(accessLinkErrorMessage({ code: 'otp_expired' }), /expirou/);
});

function pageWithAuthError(error) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', dataset: {}, disabled: false });
    return elements.get(id);
  };
  element('sync-email').value = ' Pessoa@Example.com ';
  const calls = [];
  const context = vm.createContext({
    window: { TccRealtimeSync: require('../realtime-sync.js'), location: { origin: 'https://example.com', pathname: '/organizador/' } },
    document: { getElementById: element },
    navigator: { onLine: true },
    console: { error() {} },
    authClient: { auth: { signInWithOtp: async options => { calls.push(options); return { error }; } } }
  });
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline.slice(0, inline.indexOf('(function init()')), context);
  vm.runInContext('supabaseClient = authClient; mostrarToast = () => {};', context);
  return { context, element, calls };
}

test('falha de envio fica visivel no painel e libera nova tentativa', async () => {
  const page = pageWithAuthError({ code: 'email_address_not_authorized', status: 403 });
  await vm.runInContext('enviarLinkDeAcesso({ preventDefault() {} })', page.context);
  assert.equal(page.element('sync-panel').dataset.status, 'error');
  assert.match(page.element('sync-detail').textContent, /SMTP/);
  assert.equal(page.element('sync-login-button').disabled, false);
  assert.equal(page.calls[0].email, 'pessoa@example.com');
  assert.equal(page.calls[0].options.emailRedirectTo, 'https://example.com/organizador/');
});

test('sucesso orienta caixa de entrada e nao afirma sincronizacao ativa', async () => {
  const page = pageWithAuthError(null);
  await vm.runInContext('enviarLinkDeAcesso({ preventDefault() {} })', page.context);
  assert.match(page.element('sync-detail').textContent, /spam/i);
  assert.notEqual(page.element('sync-panel').dataset.status, 'live');
});
