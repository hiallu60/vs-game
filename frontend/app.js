const main = document.querySelector('#main');
const dialog = document.querySelector('#create-dialog');
const form = document.querySelector('#create-form');
let routeVersion = 0;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => new Date(value).toLocaleDateString('ko-KR');
const picture = (url, alt) => url ? `<img src="${escape(url)}" alt="${escape(alt)}" loading="lazy">` : '';
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: response.status });
  return data;
}
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 3500); }
document.querySelector('#new-topic').onclick = () => dialog.showModal();
document.querySelector('#close-dialog').onclick = () => dialog.close();
form.onsubmit = async event => {
  event.preventDefault(); const button = form.querySelector('[type=submit]'), error = document.querySelector('#create-error');
  error.textContent = '';
  const data = new FormData(form);
  for (const name of ['image_a', 'image_b']) { const file = data.get(name); if (!file?.size) data.delete(name); else if (file.size > 5 * 1024 * 1024) { error.textContent = '이미지는 각 5MB 이하여야 합니다.'; return; } }
  button.disabled = true;
  try { const topic = await api('/topics', { method: 'POST', body: data }); dialog.close(); form.reset(); location.hash = `topic/${topic.id}`; toast('새 주제가 공개되었어요.'); }
  catch (err) { error.textContent = err.message; }
  finally { button.disabled = false; }
};
function card(topic) {
  return `<a class="card" href="#topic/${topic.id}"><h3 class="card-title">${escape(topic.title)}</h3><div class="mini-options"><div class="mini-option">${picture(topic.image_a_url, '선택지 A 이미지')}<span>${escape(topic.option_a)}</span></div><div class="mini-option">${picture(topic.image_b_url, '선택지 B 이미지')}<span>${escape(topic.option_b)}</span></div></div><div class="card-meta"><span>투표 ${Number(topic.vote_count).toLocaleString()} · 댓글 ${Number(topic.comment_count).toLocaleString()}</span><span>${date(topic.created_at)}</span></div></a>`;
}
async function list(version) {
  const data = await api('/topics'); if (version !== routeVersion) return;
  main.innerHTML = `<section class="hero"><span class="eyebrow">THIS OR THAT?</span><h1>당신의 선택은<br>어느 쪽인가요?</h1><p>고민은 짧게, 선택은 솔직하게.<br>일상 속 사소하고 어려운 선택을 함께 나눠보세요.</p><div class="hero-art" aria-hidden="true">A/B</div></section><div class="section-head"><h2>지금, 취향이 갈리는 중</h2><span class="muted small">누구나 익명으로 참여해요</span></div><div class="grid" id="topics">${data.topics.map(card).join('')}</div>${!data.topics.length ? '<div class="empty"><span class="badge a">VS</span><h3>첫 번째 고민을 들려주세요</h3><p class="muted">아직 등록된 주제가 없어요. 새로운 밸런스 게임을 시작해 보세요.</p><button class="primary" id="first-topic">첫 주제 만들기</button></div>' : ''}<button class="more" id="more-topics" ${data.next ? '' : 'hidden'}>주제 더 보기 ↓</button>`;
  document.querySelector('#first-topic')?.addEventListener('click', () => dialog.showModal());
  let next = data.next;
  document.querySelector('#more-topics').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    try { const page = await api(`/topics?before=${next}`); if (version !== routeVersion) return; document.querySelector('#topics').insertAdjacentHTML('beforeend', page.topics.map(card).join('')); next = page.next; button.hidden = !next; }
    catch (err) { toast(err.message); } finally { button.disabled = false; }
  };
}
async function detail(id, version) {
  const data = await api(`/topics/${id}`); if (version !== routeVersion) return;
  const t = data.topic;
  main.innerHTML = `<a class="back" href="#">← 모든 주제 보기</a><div class="eyebrow" style="text-align:center">MAKE YOUR CHOICE</div><h1 class="detail-title">${escape(t.title)}</h1><p class="detail-sub" id="vote-note">${data.my_choice ? '당신의 선택이 반영되었어요.' : '더 끌리는 쪽을 선택하면 모두의 결과가 공개돼요.'}</p><div class="choices">${['A', 'B'].map(choice => `<button class="choice" data-choice="${choice}"><span class="badge ${choice.toLowerCase()}">${choice}</span>${picture(t[`image_${choice.toLowerCase()}_url`], `선택지 ${choice} 이미지`)}<span>${escape(t[`option_${choice.toLowerCase()}`])}</span><div class="result" data-result="${choice}"></div></button>`).join('')}</div><p class="muted small" style="text-align:center">브라우저당 한 번만 투표할 수 있어요. 브라우저 데이터를 지우면 제한이 유지되지 않아요.</p><section class="comments"><h2>선택의 이유를 나눠보세요</h2><form class="comment-form" id="comment-form"><textarea name="content" maxlength="1000" required placeholder="당신은 왜 그쪽을 골랐나요?" aria-label="댓글 내용"></textarea><div><span class="muted small">익명으로 등록돼요 · 최대 1,000자</span><button class="primary">댓글 등록</button></div></form><div id="comments"></div><button class="more" id="more-comments" hidden>댓글 더 보기 ↓</button></section>`;
  const buttons = [...main.querySelectorAll('[data-choice]')];
  let voted = !!data.my_choice;
  async function results() {
    const r = await api(`/topics/${id}/results`); if (version !== routeVersion) return;
    document.querySelector('#vote-note').textContent = `총 ${r.total.toLocaleString()}명이 선택했어요.`;
    for (const b of buttons) { const c = b.dataset.choice; b.disabled = true; b.classList.toggle('selected', c === r.my_choice); b.querySelector('.result').innerHTML = `<div class="result-number">${r[`percent_${c.toLowerCase()}`]}<small>%</small></div><p class="selected-note">${r[c.toLowerCase()].toLocaleString()}표 ${c === r.my_choice ? '· 나의 선택 ✓' : ''}</p><div class="bar"><span style="width:${r[`percent_${c.toLowerCase()}`]}%"></span></div>`; }
  }
  buttons.forEach(button => { button.disabled = voted; button.onclick = async () => {
    buttons.forEach(b => { b.disabled = true; });
    try { await api(`/topics/${id}/votes`, { method: 'POST', body: JSON.stringify({ choice: button.dataset.choice }) }); voted = true; await results(); }
    catch (err) { if (err.status === 409) { voted = true; await results().catch(e => toast(e.message)); } else toast(err.message); }
    finally { if (!voted) buttons.forEach(b => { b.disabled = false; }); }
  }; });
  let next = null;
  async function comments(append = false) {
    const page = await api(`/topics/${id}/comments${append ? `?before=${next}` : ''}`); if (version !== routeVersion) return;
    const html = page.comments.map(c => `<article class="comment"><header><b>익명의 선택자</b><span class="muted">${date(c.created_at)}</span></header><p>${escape(c.content)}</p></article>`).join('');
    const target = document.querySelector('#comments'); if (append) target.insertAdjacentHTML('beforeend', html); else target.innerHTML = html || '<p class="muted small">아직 댓글이 없어요. 첫 의견을 남겨보세요.</p>';
    next = page.next; document.querySelector('#more-comments').hidden = !next;
  }
  document.querySelector('#more-comments').onclick = async event => { const b = event.currentTarget; b.disabled = true; try { await comments(true); } catch (err) { toast(err.message); } finally { b.disabled = false; } };
  document.querySelector('#comment-form').onsubmit = async event => {
    event.preventDefault(); const f = event.currentTarget, b = f.querySelector('button'); b.disabled = true;
    try { await api(`/topics/${id}/comments`, { method: 'POST', body: JSON.stringify({ content: f.elements.content.value }) }); f.reset(); await comments(); toast('댓글이 등록되었어요.'); }
    catch (err) { toast(err.message); } finally { b.disabled = false; }
  };
  await Promise.all([comments(), voted ? results() : Promise.resolve()]);
}
async function route() {
  const version = ++routeVersion;
  main.innerHTML = '<p class="loading" role="status">선택지를 불러오고 있어요…</p>';
  try { const match = location.hash.match(/^#topic\/([1-9]\d*)$/); if (match) await detail(match[1], version); else await list(version); }
  catch (err) { if (version === routeVersion) main.innerHTML = `<div class="empty"><h2>화면을 불러오지 못했어요</h2><p class="error">${escape(err.message)}</p><button class="primary" id="retry">다시 시도</button><p><a class="back" href="#">← 목록으로</a></p></div>`; document.querySelector('#retry')?.addEventListener('click', route); }
}
addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
route();
