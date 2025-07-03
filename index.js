const express = require('express');
const axios   = require('axios');
const app     = express();
const WIALON  = 'https://hst-api.wialon.com/wialon/ajax.html';

app.get('/groupinfo', async (req, res) => {
  const { token, group_name } = req.query;
  if (!token || !group_name)
    return res.status(400).json({ error:'token y group_name requeridos' });

  try {
    /* 1) login con token */
    const login = await axios.get(WIALON, {
      params: { svc:'token/login', params:{ token } }
    });
    if (login.data.error)
      return res.status(401).json({ error:'login_failed', login:login.data });
    const sid = login.data.eid;

    /* 2) buscar grupo */
    const group = await axios.get(WIALON, {
      params:{
        svc:'core/search_items', sid,
        params:{
          spec:{ itemsType:'avl_unit_group', propName:'sys_name',
                 propValueMask:group_name, sortType:'sys_name' },
          force:1, flags:1, from:0, to:0
        }
      }
    });
    if (!group.data.items?.length)
      return res.status(404).json({ error:'grupo_no_encontrado' });
    const groupId = group.data.items[0].id;

    /* 3) unidades */
    const units = await axios.get(WIALON, {
      params:{
        svc:'core/search_items', sid,
        params:{
          spec:{ itemsType:'avl_unit', propName:'or_group',
                 propValueMask:String(groupId) },
          force:1, flags:8193, from:0, to:0
        }
      }
    });

    /* 4) construir XML */
    const esc = s => (s??'').toString()
                 .replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const xml = ['<string><NewDataSet>',
                 `<Token>${esc(token)}</Token>`,
                 `<Sid>${sid}</Sid>`];
    (units.data.items||[]).forEach(u=>{
      const p=u.pos||{};
      xml.push('<Table>',
        `<NameOfUnit>${esc(u.nm)}</NameOfUnit>`,
        `<Latitude>${p.y??''}</Latitude>`,
        `<Longitude>${p.x??''}</Longitude>`,
        `<Speed>${p.s??''}</Speed>`,
      '</Table>');
    });
    xml.push('</NewDataSet></string>');
    res.type('xml').send(xml.join(''));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error:'proxy_failed' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=>console.log('Proxy en puerto', PORT));
