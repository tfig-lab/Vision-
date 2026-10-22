// Gera painel.html a partir dos CSVs (vários arquivos aceitos) e do de-para em XLSX.
// Uso: node gerar_painel.js --inter a.csv b.csv --vel x.csv y.csv [--depara depara.xlsx] [--binario]   (requer: npm install xlsx@0.18.5)
// --binario: grava os dados compactados em dados/parte*.bin ao lado do painel.html (recomendado para vários dias; abrir por um servidor web, não direto do disco)
const fs=require('fs');const {rodarPipeline}=require('./pipeline.js');
const args=process.argv.slice(2);const L={inter:[],vel:[],depara:null,binario:false};let cur=null;
for(const a of args){if(a==='--binario'){L.binario=true;cur=null;continue;}if(a.startsWith('--')){cur=a.slice(2);continue;}if(cur==='depara')L.depara=a;else if(L[cur])L[cur].push(a);}
let gmap=null;
if(L.depara){const XLSX=require('xlsx');const wb=XLSX.read(fs.readFileSync(L.depara),{type:'buffer'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false,defval:''});
  const norm=s=>String(s??'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');const hi=rows.findIndex(r=>r.some(c=>norm(c)==='event code'));const h=rows[hi].map(norm);
  const cc=h.indexOf('event code');let cg=h.indexOf('consolidacao operacao');if(cg<0)cg=11;gmap={};for(let i=hi+1;i<rows.length;i++){const c=String(rows[i][cc]).trim().toUpperCase(),g=String(rows[i][cg]).trim();if(c&&g&&!(c in gmap))gmap[c]=g;}}
const D=rodarPipeline(L.inter.map(f=>fs.readFileSync(f,'utf8')),L.vel.map(f=>fs.readFileSync(f,'utf8')),gmap,{},(m)=>console.log(m));
const nomes=a=>a.length===1?a[0].split(/[\\/]/).pop():`${a.length} arquivos`;D.meta.fontes={inter:nomes(L.inter),vel:nomes(L.vel),dp:L.depara?L.depara.split(/[\\/]/).pop():null};
const t=fs.readFileSync(__dirname+'/template7.html','utf8');
const pipe=fs.readFileSync(__dirname+'/pipeline.js','utf8');
if(L.binario){const {codificar}=require('./codec.js');const gz=codificar(D,{'E.t':'Float64Array'});const n=Math.max(1,Math.ceil(gz.length/14e6)),sz=Math.ceil(gz.length/n),partes=[];
  fs.mkdirSync('dados',{recursive:true});for(let i=0;i<n;i++){fs.writeFileSync('dados/parte'+i+'.bin',gz.subarray(i*sz,(i+1)*sz));partes.push('dados/parte'+i+'.bin');}
  fs.writeFileSync('painel.html',t.replace('__DATA__',JSON.stringify({partes,mb:Math.round(gz.length/1e5)/10})).replace('__PIPELINE__',()=>pipe));console.log('dados em',partes.join(', '));}
else fs.writeFileSync('painel.html',t.replace('__DATA__',()=>JSON.stringify(D).replace(/<\//g,'<\\/')).replace('__PIPELINE__',()=>pipe));
console.log('painel.html gerado');
