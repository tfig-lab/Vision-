// Monta o painel a partir do template7.html.
//   node build.js web   -> painel_enc.html (dados cifrados em dados/parte*.enc, para o index.html do GitHub)
//   node build.js local -> deploy/local/painel_local_aberto.html (dados embutidos de dados_local/parte0.bin + parte1.bin)
//   node build.js todos
const fs=require('fs');const JO=require('javascript-obfuscator');
const t=fs.readFileSync(__dirname+'/template7.html','utf8');
const pipe=JO.obfuscate(fs.readFileSync(__dirname+'/pipeline.js','utf8'),{compact:true,stringArray:true,stringArrayThreshold:0.75,identifierNamesGenerator:'hexadecimal'}).getObfuscatedCode().replace(/<\//g,'<\\/');
const uri=f=>'data:image/png;base64,'+fs.readFileSync(__dirname+'/'+f).toString('base64');
const BADGE='<span class="pilotobadge" title="Versão de testes, em desenvolvimento. Os números podem mudar e não devem ser usados para decisão.">PILOTO</span>';
const LC=fs.existsSync(__dirname+'/lvg_chuva.json')?fs.readFileSync(__dirname+'/lvg_chuva.json','utf8'):'{"lvg":[],"chuva":{}}';
const monta=(cfg,b64)=>{let h=t.replace('__LVGCHUVA__',()=>LC).replace(/__LOGO__/g,()=>uri('logo.png')).replace(/__ICONE__/g,()=>uri('icone.png')).replace('<!--PILOTO-->',BADGE).replace('__DATA__',()=>JSON.stringify(cfg)).replace('__PIPELINE__',()=>pipe);
  if(b64)h=h.replace('<script id="dados" type="application/json">',()=>`<script id="dados-b64" type="text/plain">${b64}</script>\n<script id="dados" type="application/json">`);return h;};
const modo=process.argv[2]||'todos';const tamWeb=()=>{try{return Math.round((fs.statSync('dados_local/parte0.bin').size+fs.statSync('dados_local/parte1.bin').size)/1e5)/10;}catch(e){return 12;}};
if(modo==='web'||modo==='todos'){fs.writeFileSync('painel_enc.html',monta({partes:['dados/parte0.enc','dados/parte1.enc'],mb:tamWeb(),cifrado:true}));console.log('web',(fs.statSync('painel_enc.html').size/1e6).toFixed(2),'MB');}
if(modo==='local'||modo==='todos'){const gz=Buffer.concat([fs.readFileSync('dados_local/parte0.bin'),fs.readFileSync('dados_local/parte1.bin')]);
  fs.mkdirSync('deploy/local',{recursive:true});fs.writeFileSync('deploy/local/painel_local_aberto.html',monta({embutido:true,mb:Math.round(gz.length/1e5)/10},gz.toString('base64')));console.log('local aberto',(fs.statSync('deploy/local/painel_local_aberto.html').size/1e6).toFixed(2),'MB');}
if(modo==='artifact'||modo==='todos'){fs.mkdirSync('dados',{recursive:true});['parte0','parte1'].forEach(n=>fs.writeFileSync('dados/'+n+'.txt',fs.readFileSync('dados_local/'+n+'.bin').toString('base64')));
  fs.writeFileSync('painel.html',monta({partes:['dados/parte0.txt','dados/parte1.txt'],b64:true,mb:tamWeb()}));console.log('artifact painel.html',(fs.statSync('painel.html').size/1e6).toFixed(2),'MB');}
