import assert from 'assert';

// Self-contained test matching implementation in core.js
function extractYouTubeId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  var str = urlOrId.trim().replace(/^["'<]|["'>]$/g, '');
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  var match = str.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.(?:com|com\.br|ca|co\.uk)\/(?:embed\/|v\/|watch\?v=|watch\?.+?&v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i);
  if (match && match[1]) return match[1];
  try {
    var urlObj = new URL(str.indexOf('://') === -1 ? 'https://' + str : str);
    if (urlObj.hostname.indexOf('youtube.') !== -1) {
      var vParam = urlObj.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;
      var pathParts = urlObj.pathname.split('/').filter(Boolean);
      var lastPart = pathParts[pathParts.length - 1];
      if (lastPart && /^[a-zA-Z0-9_-]{11}$/.test(lastPart)) return lastPart;
    } else if (urlObj.hostname === 'youtu.be') {
      var pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts[0] && /^[a-zA-Z0-9_-]{11}$/.test(pathParts[0])) return pathParts[0];
    }
  } catch (e) {}
  return null;
}

function matchVideoByQuery(video, query) {
  if (!query) return true;
  var q = String(query).trim().replace(/^["'<]|["'>]$/g, '');
  if (!q) return true;

  var qYtId = extractYouTubeId(q);
  var vYtId = video.link ? extractYouTubeId(video.link) : null;

  if (qYtId && vYtId && (qYtId === vYtId || qYtId.toLowerCase() === vYtId.toLowerCase())) return true;
  if (qYtId && video.link && video.link.indexOf(qYtId) !== -1) return true;

  var qLower = q.toLowerCase();
  if (video.link) {
    var vLinkLower = video.link.toLowerCase();
    if (vLinkLower.indexOf(qLower) !== -1 || qLower.indexOf(vLinkLower) !== -1) return true;
    var cleanQ = qLower.replace(/^https?:\/\/(www\.)?/, '').replace(/[?&](si|t|feature|utm_[^=]+)=[^&]+/g, '').replace(/\/+$/, '');
    var cleanV = vLinkLower.replace(/^https?:\/\/(www\.)?/, '').replace(/[?&](si|t|feature|utm_[^=]+)=[^&]+/g, '').replace(/\/+$/, '');
    if (cleanQ.length > 3 && (cleanV.indexOf(cleanQ) !== -1 || cleanQ.indexOf(cleanV) !== -1)) return true;
  }

  if (video.titulo && video.titulo.toLowerCase().indexOf(qLower) !== -1) return true;
  if (video.comentario && video.comentario.toLowerCase().indexOf(qLower) !== -1) return true;
  return false;
}

console.log('=== TESTES DE BUSCA POR LINK E IDENTIFICAÇÃO DE YOUTUBE ===\n');

// 1. YouTube watch vs youtu.be (Exact user case)
{
  const vWatch = { id: 'v1', titulo: 'GTA 5 - Missão 1', link: 'https://www.youtube.com/watch?v=WA4XCxcJy0M&t=12s' };
  const queryYoutuBe = 'https://youtu.be/WA4XCxcJy0M?si=StzppYGAkD5VDDEN';
  assert.strictEqual(matchVideoByQuery(vWatch, queryYoutuBe), true, 'Link youtu.be com ?si deve encontrar watch com &t');
  console.log('✓ 1. youtu.be?si encontra watch?v=&t corretamente');
}

// 2. youtu.be vs watch (Reverse user case)
{
  const vYoutuBe = { id: 'v2', titulo: 'GTA 5 - Missão 2', link: 'https://youtu.be/WA4XCxcJy0M?si=StzppYGAkD5VDDEN' };
  const queryWatch = 'https://www.youtube.com/watch?v=WA4XCxcJy0M&t=12s';
  assert.strictEqual(matchVideoByQuery(vYoutuBe, queryWatch), true, 'Link watch com &t deve encontrar youtu.be com ?si');
  console.log('✓ 2. watch?v=&t encontra youtu.be?si corretamente');
}

// 3. Shorts format
{
  const vShorts = { id: 'v3', titulo: 'Curiosidade Rápida', link: 'https://youtube.com/shorts/WA4XCxcJy0M?feature=share' };
  assert.strictEqual(matchVideoByQuery(vShorts, 'https://youtu.be/WA4XCxcJy0M'), true);
  assert.strictEqual(matchVideoByQuery(vShorts, 'WA4XCxcJy0M'), true);
  console.log('✓ 3. shorts/ID é compatível com youtu.be e ID puro');
}

// 4. Raw 11-char ID search
{
  const v = { id: 'v4', titulo: 'Vídeo Especial', link: 'https://www.youtube.com/watch?v=WA4XCxcJy0M' };
  assert.strictEqual(matchVideoByQuery(v, 'WA4XCxcJy0M'), true);
  console.log('✓ 4. Busca por ID direto de 11 caracteres encontra o vídeo');
}

// 5. Negative test: different YouTube IDs do not match
{
  const v = { id: 'v5', titulo: 'Outro Vídeo', link: 'https://www.youtube.com/watch?v=12345678901' };
  assert.strictEqual(matchVideoByQuery(v, 'https://youtu.be/WA4XCxcJy0M?si=StzppYGAkD5VDDEN'), false);
  console.log('✓ 5. IDs diferentes do YouTube retornam false com segurança');
}

// 6. Title and general text search
{
  const v = { id: 'v6', titulo: 'Resumo Semanal Minecraft', link: 'https://youtu.be/abcdefghijk' };
  assert.strictEqual(matchVideoByQuery(v, 'minecraft'), true);
  assert.strictEqual(matchVideoByQuery(v, 'semanal'), true);
  assert.strictEqual(matchVideoByQuery(v, 'valorant'), false);
  console.log('✓ 6. Busca textual por título continua funcionando');
}

// 7. Non-YouTube link (Vimeo / Drive / custom)
{
  const v = { id: 'v7', titulo: 'Vídeo no Vimeo', link: 'https://vimeo.com/987654321?tracker=1' };
  assert.strictEqual(matchVideoByQuery(v, 'https://vimeo.com/987654321'), true);
  console.log('✓ 7. Links não-YouTube são normalizados e encontrados');
}

console.log('\nTODOS OS TESTES DE BUSCA PASSARAM COM SUCESSO!');
