// Envoi des mails transactionnels (liens de connexion, invitations) par API HTTP.
// Sans clé configurée, le mail est écrit dans les journaux du serveur (utile en local).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, intro, buttonLabel, url, outro = '') {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#0a0c12;font-family:Helvetica,Arial,sans-serif;color:#e9ecf5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c12;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#12151f;border:1px solid #232a3b;border-radius:14px;padding:28px">
<tr><td style="font-size:22px;letter-spacing:3px;color:#3998EB;font-weight:bold;padding-bottom:18px">LANTERNE</td></tr>
<tr><td style="font-size:18px;color:#fff;padding-bottom:12px">${esc(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55;color:#c5cbdb;padding-bottom:22px">${intro}</td></tr>
<tr><td style="padding-bottom:22px"><a href="${esc(url)}" style="display:inline-block;background:#3998EB;color:#0a0c12;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">${esc(buttonLabel)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#8a93a8">${outro}Si le bouton ne marche pas, copiez ce lien :<br><span style="word-break:break-all;color:#3998EB">${esc(url)}</span></td></tr>
</table>
<p style="font-size:12px;color:#5d6578;margin-top:16px">Lanterne · l'agenda commun des associations stéphanoises</p>
</td></tr></table></body></html>`;
}

// Deux services possibles :
//  - Brevo (BREVO_API_KEY) : il suffit de vérifier une adresse d'expéditeur, pas besoin de nom de domaine ;
//  - Resend (RESEND_API_KEY) : demande un nom de domaine vérifié pour écrire à tout le monde.
function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || 'Lanterne', email: m[2] } : { name: 'Lanterne', email: from.trim() };
}

// La clé Brevo peut arriver sous plusieurs formes : on la nettoie, et on décode la clé
// « connecteur » (base64 d'un JSON qui contient la vraie clé API) si c'est celle-ci qui a été collée.
export function brevoKey() {
  let k = String(process.env.BREVO_API_KEY || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
  if (k && !k.startsWith('xkeysib-') && !k.startsWith('xsmtpsib-')) {
    try {
      const j = JSON.parse(Buffer.from(k, 'base64').toString('utf8'));
      const inner = j.api_key || j.apiKey || j.key;
      if (typeof inner === 'string' && inner.trim()) k = inner.trim();
    } catch { /* pas une clé encodée */ }
  }
  return k;
}
export function describeMailSetup() {
  const k = brevoKey();
  if (k) {
    const kind = k.startsWith('xkeysib-') ? 'clé API (correcte)' : k.startsWith('xsmtpsib-') ? 'clé SMTP (ne marche pas ici : il faut une clé API « xkeysib- »)' : 'format inconnu';
    const decoded = String(process.env.BREVO_API_KEY || '').trim() !== k ? ', nettoyée ou décodée' : '';
    return `Brevo — ${kind}${decoded}, ${k.length} caractères`;
  }
  if (process.env.RESEND_API_KEY) return 'Resend';
  return 'aucun service d’envoi (les mails sont écrits dans le journal)';
}

// Plafond journalier : on garde une marge sous le quota gratuit de Brevo (300 mails par jour)
const DAILY_LIMIT = Number(process.env.MAIL_DAILY_LIMIT || 280);
let dayKey = ''; let sentToday = 0;

export async function sendMail({ to, subject, html, text }) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; sentToday = 0; }
  if (sentToday >= DAILY_LIMIT) {
    console.error(`[mail] plafond journalier atteint (${DAILY_LIMIT}), mail non envoyé à ${to.replace(/(.).*@/, '$1…@')}`);
    return { ok: false };
  }
  sentToday++;
  const from = process.env.MAIL_FROM || 'Lanterne <onboarding@resend.dev>';
  try {
    if (brevoKey()) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevoKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: parseFrom(from), to: [{ email: to }], subject, htmlContent: html, textContent: text }),
      });
      if (!res.ok) { console.error('[mail] échec Brevo', res.status, await res.text()); return { ok: false }; }
      return { ok: true };
    }
    if (process.env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
      if (!res.ok) { console.error('[mail] échec Resend', res.status, await res.text()); return { ok: false }; }
      return { ok: true };
    }
  } catch (err) {
    console.error('[mail] erreur réseau', err.message);
    return { ok: false };
  }
  console.log(`\n[mail] (aucun service d'envoi configuré, mail non envoyé)\n  À : ${to}\n  Objet : ${subject}\n  ${text}\n`);
  return { ok: true, logged: true };
}

export function loginMail(to, url) {
  return sendMail({
    to,
    subject: 'Votre lien de connexion à Lanterne',
    html: layout('Connexion à Lanterne', 'Cliquez sur le bouton pour vous connecter. Ce lien est valable 30 minutes et ne sert qu’une fois.', 'Me connecter', url, 'Vous n’avez rien demandé ? Ignorez simplement ce mail.<br><br>'),
    text: `Pour vous connecter à Lanterne, ouvrez ce lien (valable 30 minutes) : ${url}`,
  });
}

export function inviteMail(to, assoName, inviterName, url) {
  return sendMail({
    to,
    subject: `${assoName} vous invite sur Lanterne`,
    html: layout(`Rejoignez ${assoName} sur Lanterne`,
      `${esc(inviterName || 'Un membre')} vous invite à rejoindre <b>${esc(assoName)}</b> sur Lanterne, l’agenda commun des associations stéphanoises. Vous pourrez y poser les dates de l’association et voir celles des autres.`,
      'Rejoindre l’association', url),
    text: `${inviterName || 'Un membre'} vous invite à rejoindre ${assoName} sur Lanterne : ${url}`,
  });
}

export function adminNewAssoMail(to, assoName, url) {
  return sendMail({
    to,
    subject: `Nouvelle association à valider : ${assoName}`,
    html: layout('Une association attend sa validation', `<b>${esc(assoName)}</b> vient de s’inscrire sur Lanterne. Vérifiez qu’elle existe vraiment, puis validez-la.`, 'Voir les inscriptions', url),
    text: `${assoName} vient de s'inscrire sur Lanterne. À valider : ${url}`,
  });
}

export function approvedMail(to, assoName, url) {
  return sendMail({
    to,
    subject: `${assoName} est validée sur Lanterne`,
    html: layout('Votre association est validée', `<b>${esc(assoName)}</b> fait maintenant partie de Lanterne. Vous pouvez poser vos dates et inviter les autres membres.`, 'Ouvrir Lanterne', url),
    text: `${assoName} est validée sur Lanterne : ${url}`,
  });
}
