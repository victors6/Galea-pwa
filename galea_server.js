const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

// ── Health ────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ ok: true, sistema: "Galea Backend" }));
app.get("/health", (req, res) => res.send("ok"));

// ── Proxy genérico AI (mantiene compatibilidad con frontend React) ────
app.post("/proxy", async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.model) body.model = MODEL;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Chat asistente ────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { system, messages, message, context } = req.body;
  const msgs = messages || [{ role: "user", content: message || "" }];
  const sys = system || context || "Eres el asistente de Galea restaurante. Responde en español, conciso y útil.";
  if (!msgs.length) return res.status(400).json({ error: "Falta messages" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: sys, messages: msgs }),
    });
    const data = await r.json();
    const reply = data.content ? data.content.map(b => b.text || "").join("").trim() : "";
    // Compatibilidad con ambos formatos de respuesta
    res.json({ content: reply, reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Scan factura por imagen ───────────────────────────────────────────
app.post("/scan-factura", async (req, res) => {
  const { image_base64, media_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: "Falta image_base64" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1500,
        system: 'Eres experto en facturas de restaurante y bar. Analiza la imagen y extrae todos los productos. Responde SOLO con JSON valido sin texto extra. Estructura: {"proveedor":"string","fecha":"string","productos":[{"nombre":"string","cantidad":1,"unidad":"kg","precio_unitario":0,"precio_total":0,"categoria":"Carnes"}],"total_factura":0}',
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image_base64 } },
          { type: "text", text: "Extrae todos los productos y precios de esta factura." }
        ]}]
      }),
    });
    const data = await r.json();
    const raw = data.content.map(b => b.text || "").join("").trim();
    const jm = raw.match(/\{[\s\S]*\}/);
    res.json(jm ? JSON.parse(jm[0]) : JSON.parse(raw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Scan menú por imagen ──────────────────────────────────────────────
app.post("/scan-menu", async (req, res) => {
  const { image_base64, media_type, prompt } = req.body;
  if (!image_base64) return res.status(400).json({ error: "Falta image_base64" });
  const sys = prompt || 'Eres experto en menús de restaurante. Analiza la imagen y extrae todos los platillos/bebidas. Responde SOLO con JSON valido. Estructura: {"area":"string","items":[{"nombre":"string","descripcion":"string o null","precio":0,"categoria":"string"}]}';
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2000, system: sys,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image_base64 } },
          { type: "text", text: "Lee el menú completo y extrae todos los items con sus precios." }
        ]}]
      }),
    });
    const data = await r.json();
    const raw = data.content.map(b => b.text || "").join("").trim();
    const jm = raw.match(/\{[\s\S]*\}/);
    res.json(jm ? JSON.parse(jm[0]) : JSON.parse(raw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Export Excel con fórmulas (fichas de costo) ───────────────────────
app.post('/export-excel', async (req, res) => {
  const { recetas, inventario, cliente } = req.body;
  const margenDeseado = parseFloat(req.body.margen) || 60;
  if (!recetas || !recetas.length) return res.status(400).json({ error: 'Sin recetas' });
  try {
    let ExcelJS;
    try { ExcelJS = require('exceljs'); } catch(e) {
      return res.status(500).json({ error: 'exceljs no instalado — corre npm install' });
    }
    const wb = new ExcelJS.Workbook();
    const hoy = new Date().toLocaleDateString('es-MX');
    const esCliente = !!cliente;
    // Galea: colores oscuros
    const ACC='F97316', ACC_L='3B1A0A', GRIS='1A2035', GRIS_D='0E1120';
    const BLANCO='F1F5F9', NEGRO='07080F', ROJO='EF4444', VERDE='22C55E';

    const sc = (c, o={}) => {
      const {v, bold=false, sz=10, col=BLANCO, bg=null, h='left', wrap=false, fmt=null, result=null} = o;
      if (v !== undefined) {
        if (typeof v === 'string' && v.startsWith('=')) {
          c.value = { formula: v.substring(1), result: result !== null ? result : 0 };
        } else { c.value = v; }
      }
      c.font = {name:'Arial', size:sz, bold, color:{argb:'FF'+col}};
      c.alignment = {horizontal:h, vertical:'middle', wrapText:wrap};
      if (bg) c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF'+bg}};
      if (fmt) c.numFmt = fmt;
      c.border = { top:{style:'thin',color:{argb:'FF1A2035'}}, bottom:{style:'thin',color:{argb:'FF1A2035'}},
                   left:{style:'thin',color:{argb:'FF1A2035'}}, right:{style:'thin',color:{argb:'FF1A2035'}} };
    };
    const mg = (ws,r1,c1,r2,c2) => { try { ws.mergeCells(r1,c1,r2,c2); } catch(e){} };

    // Hoja Precios
    const wsPx = wb.addWorksheet('Precios');
    wsPx.showGridLines = false;
    wsPx.columns = [{width:32},{width:10},{width:14},{width:22}];
    mg(wsPx,1,1,1,4);
    sc(wsPx.getCell(1,1),{v:esCliente?`PRECIOS — ${cliente.nombre}`:'PRECIOS — GALEA',bold:true,sz:13,col:NEGRO,bg:ACC,h:'center'});
    wsPx.getRow(1).height=24;
    mg(wsPx,2,1,2,4);
    sc(wsPx.getCell(2,1),{v:'Cambia el precio en col C → todos los costos se actualizan solos',sz:9,col:ROJO,bg:'1A0A00',h:'center'});
    wsPx.getRow(2).height=14;
    const hpx=wsPx.addRow(['Ingrediente','Unidad','Precio/Unidad','Proveedor']);
    hpx.eachCell((c,i)=>{ if(i<=4) sc(c,{bold:true,sz:9,col:NEGRO,bg:ACC,h:'center'}); });
    hpx.height=15;
    const PX_START=4;
    (inventario||[]).slice().sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||'')).forEach((p,i)=>{
      const row=wsPx.addRow([p.nombre,p.unidad||p.uni||'Kg',p.precio||0,p.proveedor||p.prov||'']);
      const bg=i%2===0?GRIS_D:GRIS;
      sc(row.getCell(1),{sz:9,bg,col:BLANCO}); sc(row.getCell(2),{sz:9,bg,col:BLANCO,h:'center'});
      sc(row.getCell(3),{sz:10,bold:true,col:ACC,bg,h:'right',fmt:'"$"#,##0.0000'});
      sc(row.getCell(4),{sz:9,bg,col:BLANCO});
      row.height=15;
    });
    const PX_END=PX_START+(inventario||[]).length-1;
    const PRICE_RANGE=`Precios!$A$${PX_START}:$C$${Math.max(PX_END,PX_START)}`;

    // Hoja Índice
    const wsIdx=wb.addWorksheet('Indice');
    wsIdx.showGridLines=false;
    wsIdx.columns=[{width:4},{width:30},{width:16},{width:12},{width:12},{width:10},{width:10}];
    mg(wsIdx,1,1,1,7);
    sc(wsIdx.getCell(1,1),{v:esCliente?`FICHAS DE COSTO — ${cliente.nombre}`:'FICHAS DE COSTO — GALEA',bold:true,sz:14,col:NEGRO,bg:ACC,h:'center'});
    wsIdx.getRow(1).height=28;
    const hidx=wsIdx.addRow(['#','Receta','Categoria','PVP','Costo Unit.','Margen %','Rendimiento']);
    hidx.eachCell((c,i)=>{ if(i<=7) sc(c,{bold:true,sz:9,col:NEGRO,bg:ACC,h:'center'}); });
    hidx.height=16;

    // Una hoja por receta
    const usedNames=new Set();
    recetas.forEach((r,rIdx)=>{
      let sName=(r.nombre||'Receta').substring(0,31);
      let n=0; while(usedNames.has(sName)){n++;sName=(r.nombre||'Receta').substring(0,28)+'_'+n;}
      usedNames.add(sName);
      const ws=wb.addWorksheet(sName);
      ws.showGridLines=false;
      ws.columns=[{width:14},{width:30},{width:10},{width:10},{width:12},{width:14},{width:14},{width:8},{width:2},{width:18},{width:14}];
      const pvp=r.pvp||0; const rend=r.rendimiento||1; const ings=r.ingredientes||[];
      const IS=16, IE=IS+19;
      const costoTotal=ings.reduce((s,i)=>s+(i.costo||0),0);
      const cu=rend>0?costoTotal/rend:costoTotal;
      const margen=pvp>0?(pvp-cu)/pvp:0;
      const precioSug=margenDeseado<100?cu/(1-margenDeseado/100):cu*2;

      // Fila 1
      mg(ws,1,1,1,8); mg(ws,1,10,1,11);
      sc(ws.getCell(1,1),{v:'FICHA DE COSTO  —  GALEA',bold:true,sz:13,col:NEGRO,bg:ACC,h:'center'});
      sc(ws.getCell(1,10),{v:'GALEA 🍽',bold:true,sz:12,col:NEGRO,bg:ACC,h:'center'});
      ws.getRow(1).height=24;

      const infoL=[
        ['Nombre',r.nombre,null,false,r.nombre],
        ['Rendimiento (batch)',rend,'0.0##',false,rend],
        ['Tamano de la porcion',1,'#,##0.000',false,1],
        ['Numero de porciones',`=C3`,'#,##0.00',false,rend],
        ['PVP (precio venta)',pvp,'"$"#,##0.00','pvp',pvp],
        ['Margen Bruto %',`=IFERROR((C6-C9)/C6,0)`,'0.0%','hl',margen],
        ['Costo Directo (batch)',`=SUM(G${IS}:G${IE})`,'"$"#,##0.00','hl',costoTotal],
        ['CU (Costo Unitario)',`=IFERROR(SUM(G${IS}:G${IE})/C3,0)`,'"$"#,##0.00','cu',cu],
        [`Precio sugerido ${margenDeseado}%`,`=IFERROR(C9/(1-${margenDeseado}/100),0)`,'"$"#,##0.00','sug',precioSug],
        ['Clasificacion',r.categoria||'',null,false,r.categoria||''],
      ];
      infoL.forEach(([lbl,val,fmt,hl,res],idx)=>{
        const row=idx+2;
        mg(ws,row,1,row,2); mg(ws,row,3,row,5);
        sc(ws.getCell(row,1),{v:lbl,bold:true,sz:9,bg:GRIS,col:BLANCO});
        sc(ws.getCell(row,3),{v:val,sz:hl?10:9,bold:!!hl,h:'right',
          bg:hl==='pvp'?'EAB308':hl==='sug'?'14532D':hl?GRIS:GRIS_D,
          col:hl==='sug'?VERDE:hl&&hl!=='pvp'&&hl!=='cu'?ACC:BLANCO,
          fmt:fmt||null,result:res});
        ws.getRow(row).height=16;
      });

      const infoR=[
        ['Fecha',hoy,null,false,hoy],['Receta',r.nombre,null,false,r.nombre],['','',null,false,''],
        ['Costo Unit.',`=C9`,'"$"#,##0.00',false,cu],['PVP',`=C6`,'"$"#,##0.00',false,pvp],
        ['c/IVA',`=C6*1.16`,'"$"#,##0.00',false,pvp*1.16],['Utilidad',`=C6-C9`,'"$"#,##0.00',true,pvp-cu],
        ['% Costo',`=IFERROR(C9/C6,0)`,'0.0%',false,pvp>0?cu/pvp:0],
        ['% Utilidad',`=IFERROR((C6-C9)/C6,0)`,'0.0%',true,margen],
        ['Costo Batch',`=SUM(G${IS}:G${IE})`,'"$"#,##0.00',true,costoTotal],
      ];
      infoR.forEach(([lbl,val,fmt,hl,res],idx)=>{
        const row=idx+2;
        sc(ws.getCell(row,10),{v:lbl,bold:true,sz:9,bg:hl?ACC:GRIS,col:hl?NEGRO:BLANCO});
        sc(ws.getCell(row,11),{v:val,sz:hl?10:9,bold:hl,h:'right',bg:hl?ACC:GRIS_D,col:hl?NEGRO:BLANCO,fmt,result:res});
        ws.getRow(row).height=16;
      });

      // Tabla ingredientes
      mg(ws,12,1,12,8);
      sc(ws.getCell(12,1),{v:'INGREDIENTES',bold:true,sz:10,col:NEGRO,bg:ACC});
      ws.getRow(12).height=16;
      ['Proveedor','Ingrediente','Unidad','Cantidad','% Rend.','Costo Unit.','Costo Total','%'].forEach((h,i)=>
        sc(ws.getRow(13).getCell(i+1),{v:h,bold:true,sz:9,col:NEGRO,bg:ACC,h:'center'}));
      ws.getRow(13).height=15;
      mg(ws,14,1,14,8);
      sc(ws.getCell(14,1),{v:'Azul = edita CANTIDAD | Naranja = precio desde hoja Precios (VLOOKUP)',sz:8,col:ROJO,bg:GRIS,h:'center'});
      ws.getRow(14).height=13;

      for(let i=0;i<20;i++){
        const row=IS+i; const ing=ings[i]||null; const bg=i%2===0?GRIS_D:GRIS;
        ws.getRow(row).height=15;
        if(ing){
          const invNombre=ing.invNombre||ing.nombre;
          const pct=costoTotal>0?(ing.costo||0)/costoTotal:0;
          sc(ws.getCell(row,1),{v:ing.proveedor||'',sz:9,bg,col:BLANCO});
          sc(ws.getCell(row,2),{v:invNombre,sz:9,bg,col:BLANCO});
          sc(ws.getCell(row,3),{v:`=IFERROR(VLOOKUP(B${row},${PRICE_RANGE},2,0),"")`,sz:9,bg,col:BLANCO,h:'center',result:ing.unidad||''});
          sc(ws.getCell(row,4),{v:ing.cantidad,sz:10,bold:true,col:'60A5FA',bg:'0C2340',h:'right',fmt:'0.000'});
          sc(ws.getCell(row,5),{v:1,sz:9,bg,col:BLANCO,h:'center',fmt:'0%'});
          sc(ws.getCell(row,6),{v:`=IFERROR(VLOOKUP(B${row},${PRICE_RANGE},3,0),0)`,sz:9,bold:true,col:ACC,bg,h:'right',fmt:'"$"#,##0.0000',result:ing.precio||0});
          sc(ws.getCell(row,7),{v:`=IF(D${row}="","",D${row}*E${row}*F${row})`,sz:9,bold:true,bg,col:BLANCO,h:'right',fmt:'"$"#,##0.00',result:ing.costo||0});
          sc(ws.getCell(row,8),{v:`=IFERROR(G${row}/SUM(G${IS}:G${IE}),0)`,sz:9,bg,col:BLANCO,h:'center',fmt:'0.0%',result:pct});
        } else {
          for(let j=1;j<=8;j++) sc(ws.getCell(row,j),{bg,col:BLANCO});
          sc(ws.getCell(row,4),{bg:'0C2340',h:'right',fmt:'0.000',col:'60A5FA'});
          sc(ws.getCell(row,5),{v:1,bg,col:BLANCO,h:'center',fmt:'0%'});
        }
      }

      const TOT=IE+1;
      mg(ws,TOT,1,TOT,6);
      sc(ws.getCell(TOT,1),{v:'TOTAL',bold:true,sz:11,col:NEGRO,bg:ACC,h:'right'});
      sc(ws.getCell(TOT,7),{v:`=SUM(G${IS}:G${IE})`,bold:true,sz:11,col:NEGRO,bg:ACC,h:'right',fmt:'"$"#,##0.00',result:costoTotal});
      sc(ws.getCell(TOT,8),{v:'100%',bold:true,col:NEGRO,bg:ACC,h:'center'});
      ws.getRow(TOT).height=18;

      const CU_ROW=TOT+1;
      mg(ws,CU_ROW,1,CU_ROW,3); mg(ws,CU_ROW,4,CU_ROW,6);
      sc(ws.getCell(CU_ROW,1),{v:`Rinde ${rend} ${rend===1?'porcion':r.rendimiento_uni||'unidades'}`,bold:true,sz:9,bg:GRIS,col:BLANCO});
      sc(ws.getCell(CU_ROW,4),{v:`=IFERROR(SUM(G${IS}:G${IE})/C3,0)`,bold:true,sz:11,col:ACC,bg:GRIS,h:'center',fmt:'"$"#,##0.00',result:cu});
      sc(ws.getCell(CU_ROW,7),{v:`=C6-IFERROR(SUM(G${IS}:G${IE})/C3,0)`,bold:true,sz:10,col:VERDE,bg:GRIS,h:'right',fmt:'"$"#,##0.00',result:pvp-cu});
      sc(ws.getCell(CU_ROW,8),{v:`=IFERROR((C6-IFERROR(SUM(G${IS}:G${IE})/C3,0))/C6,0)`,bold:true,col:margen>=0.6?VERDE:ROJO,bg:GRIS,h:'center',fmt:'0.0%',result:margen});
      ws.getRow(CU_ROW).height=17;

      const PROC=CU_ROW+2;
      mg(ws,PROC,1,PROC,11);
      sc(ws.getCell(PROC,1),{v:'PROCEDIMIENTO / MÉTODO',bold:true,sz:10,col:NEGRO,bg:ACC});
      ws.getRow(PROC).height=15;
      mg(ws,PROC+1,1,PROC+3,11);
      sc(ws.getCell(PROC+1,1),{v:r.procedimiento||'',sz:9,col:BLANCO,bg:GRIS_D,wrap:true});
      ws.getRow(PROC+1).height=50;

      const iRow=wsIdx.addRow([rIdx+1,r.nombre,r.categoria,pvp,cu,margen,rend]);
      iRow.height=15;
      const ibg=rIdx%2===0?GRIS_D:GRIS;
      [1,2,3,4,5,6,7].forEach((col,i)=>{
        const fmts=[null,null,null,'"$"#,##0.00','"$"#,##0.00','0.0%','0.0##'];
        sc(iRow.getCell(col),{sz:9,bg:ibg,col:BLANCO,h:col===2?'left':'center',fmt:fmts[i]||null,
          bold:col===6,col:col===6?(margen>=0.6?VERDE:margen>=0.4?BLANCO:ROJO):BLANCO});
      });
    });

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="galea_fichas_${new Date().toISOString().split('T')[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();

  } catch(e) {
    console.error('export-excel galea:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Ping Supabase cada 3 días (keep-alive plan gratuito) ────────────
const SB_URL = process.env.SUPABASE_URL || 'https://epgyvdbqinfucajvscns.supabase.co';
const SB_KEY = process.env.SUPABASE_KEY || '';
setInterval(async () => {
  try {
    await fetch(`${SB_URL}/rest/v1/ingredientes?limit=1`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    console.log('Supabase ping OK -', new Date().toISOString());
  } catch(e) { console.log('Supabase ping failed:', e.message); }
}, 3 * 24 * 60 * 60 * 1000);

const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Galea backend en puerto ${PORT}`));
