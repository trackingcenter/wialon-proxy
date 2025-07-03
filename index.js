// index.js  – TTC Wialon Proxy (versión 2025-07-03)

const express = require('express');
const axios   = require('axios');
const app     = express();

// URL base del Remote API de Wialon
const WIALON = 'https://hst-api.wialon.com/wialon/ajax.html';

/* ----------------------------------------------
 * Helper: hace una llamada GET a Wialon
 * Siempre stringify(params) y añade timeout.
 * --------------------------------------------*/
function wialonRequest({ svc, sid, params }) {
  return axios.get(WIALON, {
    params: {
      svc,
      ...(sid ? { sid } : {}),
      params: JSON.stringify(params)   // ⇠ Wialon exige JSON en string
    },
    timeout: 20_000                    // 20 s para evitar cuelgues
  }).then(r => r.data);
}

/* ───────── Ruta raíz: mensaje de cortesía ───────── */
app.get('/', (_, res) => {
  res.send(
    'Wialon proxy activo.<br>' +
    'Ejemplo: /groupinfo?token=TOKEN&group_name=WS%20G396%20ALFER%20REC%20GOODYEAR'
  );
});

/* ───────── Endpoint principal ───────── */
app.get('/groupinfo', async (req, res) => {

  /* 0. Validar parámetros */
  const { token, user, password, group_name } = req.query;
  if (!group_name) {
    return res.status(400).json({ error: 'group_name requerido' });
  }

  /* 1. LOGIN ------------------------------------------------ */
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

    /* 2. BUSCAR GRUPO -------------------------------------- */
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

    /* 3. LISTAR UNIDADES ----------------------------------- */
    let un;
    const unitIds = grp.items[0].u || [];

    if (unitIds.length) {
      // vía lista de IDs (más confiable que or_group)
      un = await wialonRequest({
        svc: 'core/search_item_list',
        sid,
        params: { items: unitIds, flags: 8193 }      // 8193 = info + última pos
      });
    } else {
      // fallback: todas las unidades visibles para el token
      un = await wialonRequest({
        svc: 'core/search_items',
        sid,
        params: {
          spec: { itemsType: 'avl_unit',
                  propName: 'sys_name', propValueMask: '*' },
          force: 1, flags: 8193, from: 0, to: 0
        }
      });
    }

    /* 4. CONSTRUIR XML ------------------------------------- */
    const esc = s => (s ?? '').toString().replace(/[&<>]/g,
                 c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]));
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

/* ───────── Iniciar servidor ───────── */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log('Proxy Wialon escuchando en puerto ' + PORT)
);
