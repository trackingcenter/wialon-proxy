// index.js  ────────────────────────────────────────────────
const express = require('express');
const axios   = require('axios');
const app     = express();
const WIALON  = 'https://hst-api.wialon.com/wialon/ajax.html';

/* ----------------------------------------------------------
 *  Helper – simplifica llamadas a la API Remote de Wialon
 * --------------------------------------------------------*/
function wialonRequest({ svc, sid, params }) {
  return axios.get(WIALON, {
    params: {
      svc,
      ...(sid ? { sid } : {}),
      params: JSON.stringify(params)      // <-- SIEMPRE stringify
    },
    timeout: 20_000                      // 20 s de seguridad
  }).then(r => r.data);
}

/* ---------- Ruta de cortesía -------------------------------- */
app.get('/', (_, res) => {
  res.send(
    'Wialon proxy activo.<br>Ejemplo: ' +
    '/groupinfo?token=TOKEN&group_name=MI%20GRUPO'
  );
});

/* ---------- Endpoint principal ------------------------------ */
app.get('/groupinfo', async (req, res) => {
  const { token, user, password, group_name } = req.query;
  if (!group_name) {
    return res.status(400).json({ error: 'group_name requerido' });
  }

  /* 1. LOGIN */
  let svcLogin, paramsLogin;
  if (token) {
    svcLogin    = 'token/login';
    paramsLogin = { token };
  } else if (user && password) {
    svcLogin    = 'core/login';
    paramsLogin = { user, password };
  } else {
    return res.status(400).json({ error: 'pasa token ó user+password' });
  }

  try {
    const login = await wialonRequest({ svc: svcLogin, params: paramsLogin });
    if (login.error) {
      return res.status(401).json({ error: 'login_failed', login });
    }
    const sid = login.eid;

    /* 2. BUSCAR GRUPO */
    const grp = await wialonRequest({
      svc: 'core/search_items',
      sid,
      params: {
        spec: {
          itemsType: 'avl_unit_group',
          propName:  'sys_name',
          propValueMask: group_name,
          sortType:  'sys_name'
        },
        force: 1, flags: 1, from: 0, to: 0
      }
    });
    if (!grp.items?.length) {
      return res.status(404).json({ error: 'grupo_no_encontrado' });
    }
    const groupId = grp.items[0].id;

    /* 3. LISTAR UNIDADES */
    const un = await wialonRequest({
      svc: 'core/search_items',
      sid,
      params: {
        spec: {
          itemsType: 'avl_unit',
          propName:  'or_group',
          propValueMask: String(groupId)
        },
        force: 1,
        flags: 8193,          // datos básicos + última posición
        from: 0,
        to:   0
      }
    });

    /* 4. FORMAR XML */
    const esc = s => (s ?? '').toString()
                    .replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const xml = ['<string><NewDataSet>'];
    if (token) xml.push(`<Token>${esc(token)}</Token>`);
    if (user)  xml.push(`<User>${esc(user)}</User>`);
    xml.push(`<Sid>${sid}</Sid>`);

    (un.items || []).forEach(u => {
      const p = u.pos || {};
      xml.push(
        '<Table>',
          `<NameOfUnit>${esc(u.nm)}</NameOfUnit>`,
          `<Latitude>${p.y ?? ''}</Latitude>`,
          `<Longitude>${p.x ?? ''}</Longitude>`,
          `<Speed>${p.s ?? ''}</Speed>`,
        '</Table>'
      );
    });
    xml.push('</NewDataSet></string>');
    res.type('xml').send(xml.join(''));

  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'proxy_failed', detail: err.message });
  }
});

/* ---------- Levantar servidor ------------------------------ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`Proxy Wialon escuchando en puerto ${PORT}`)
);
