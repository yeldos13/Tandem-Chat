const api = window.note;
const $ = (id) => document.getElementById(id);

let hideTimer = null;
let hovered = false;
let replying = false;
let failedText = 'Не удалось отправить';

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!hovered && !replying) api.close();
  }, 7000);
}

const SOUNDS = {
  note: [[880, 1320, 0.25]],
  bell: [[1046, 1046, 0.5], [1568, 1568, 0.6]],
  drop: [[1400, 500, 0.18]]
};

function beep(kind) {
  const tones = SOUNDS[kind || 'note'];
  if (!tones) return;
  try {
    const ctx = new AudioContext();
    tones.forEach(([from, to, length], i) => {
      const start = ctx.currentTime + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(from, start);
      osc.frequency.exponentialRampToValueAtTime(to, start + length * 0.4);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + length + 0.05);
    });
  } catch {}
}

api.onData((data) => {
  document.documentElement.dataset.theme = data.theme || 'blue-dark';
  const labels = data.labels || {};
  if (labels.close) $('close').title = labels.close;
  if (labels.reply) $('reply-btn').textContent = labels.reply;
  if (labels.placeholder) $('reply-input').placeholder = labels.placeholder;
  if (labels.send) $('send').title = labels.send;
  failedText = labels.failed || failedText;
  $('title').textContent = data.title || 'Tandem Chat';
  $('body').textContent = data.body || '';
  $('account').textContent = data.account || '';
  const avatar = $('avatar');
  if (data.icon && /^data:image\//.test(data.icon)) avatar.style.backgroundImage = `url("${data.icon}")`;
  else avatar.textContent = ((data.title || 'W').trim()[0] || 'W').toUpperCase();
  $('reply-btn').hidden = !data.canReply;
  if (!data.silent) beep(data.sound);
  scheduleHide();
});

document.body.addEventListener('mouseenter', () => {
  hovered = true;
});
document.body.addEventListener('mouseleave', () => {
  hovered = false;
  scheduleHide();
});

$('card').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  api.open();
});
$('close').addEventListener('click', () => api.close());
$('reply-btn').addEventListener('click', () => {
  replying = true;
  $('reply').hidden = false;
  api.expand(true);
  setTimeout(() => $('reply-input').focus(), 60);
});

$('reply').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('reply-input');
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  $('send').disabled = true;
  $('error').textContent = '';
  const res = await api.reply(text);
  if (!res || !res.ok) {
    input.disabled = false;
    $('send').disabled = false;
    $('error').textContent = (res && res.error) || failedText;
    input.focus();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.close();
});
