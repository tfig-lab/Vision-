// Gera e mantém o index.html protegido por login (usuário + senha) do painel.
// O painel fica criptografado (AES-256-GCM) com uma chave aleatória; cada usuário guarda
// uma cópia dessa chave cifrada com a própria senha (PBKDF2-SHA256). Nenhuma senha fica no arquivo.
//
// Uso (Node 18+, sem dependências):
//   node proteger.js criar     --painel painel.html --usuario admin --senha "S3nha"            [--saida index.html]
//   node proteger.js adicionar --admin admin --senha-admin "S3nha" --usuario joao --senha "Outra" [--index index.html]
//   node proteger.js remover   --admin admin --senha-admin "S3nha" --usuario joao                 [--index index.html]
//   node proteger.js senha     --usuario joao --senha "Atual" --nova "Nova"                       [--index index.html]
//   node proteger.js atualizar --admin admin --senha-admin "S3nha" --painel painel_novo.html     [--index index.html]
//   node proteger.js listar                                                                        [--index index.html]
const fs=require('fs'),path=require('path'),zlib=require('zlib');const wc=require('crypto').webcrypto,subtle=wc.subtle;
const ITER=600000,enc=new TextEncoder();
const b64=u=>Buffer.from(u).toString('base64'),ub=s=>new Uint8Array(Buffer.from(s,'base64'));
const rnd=n=>wc.getRandomValues(new Uint8Array(n));
const A=process.argv.slice(2),cmd=A[0],O={};for(let i=1;i<A.length;i+=2)O[A[i].replace(/^--/,'')]=A[i+1];
const need=(...k)=>k.forEach(x=>{if(!O[x])fail(`faltou --${x}`);});
function fail(m){console.error('Erro: '+m);process.exit(1);}
const uid=async u=>Buffer.from(await subtle.digest('SHA-256',enc.encode('vision:'+u.trim().toLowerCase()))).toString('hex');
async function kek(pw,salt){const b=await subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveKey']);
  return subtle.deriveKey({name:'PBKDF2',salt,iterations:ITER,hash:'SHA-256'},b,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function wrap(K,pw){const s=rnd(16),iv=rnd(12);const c=await subtle.encrypt({name:'AES-GCM',iv},await kek(pw,s),K);return {s:b64(s),iv:b64(iv),k:b64(new Uint8Array(c))};}
async function unwrap(C,u,pw){const e=C.users[await uid(u)];if(!e)fail('usuário não encontrado: '+u);
  try{return new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:ub(e.iv)},await kek(pw,ub(e.s)),ub(e.k)));}catch(_){fail('senha incorreta para '+u);}}
function paginaCompleta(h){if(/^\s*<!doctype/i.test(h))return h;
  return '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'+h+'\n</html>\n';}
async function cifrarPainel(K,arquivo){const html=paginaCompleta(fs.readFileSync(arquivo,'utf8'));const gz=zlib.gzipSync(Buffer.from(html,'utf8'),{level:9});
  const iv=rnd(12),k=await subtle.importKey('raw',K,'AES-GCM',false,['encrypt']);return {iv:b64(iv),ct:b64(new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv},k,gz)))};}
const TPL=path.join(__dirname,'login_template.html');
function ler(f){const t=fs.readFileSync(f,'utf8');const m=t.match(/<script id="cfg" type="application\/json">([\s\S]*?)<\/script>/);if(!m)fail(f+' não é um index protegido');return JSON.parse(m[1]);}
function gravar(f,C){fs.writeFileSync(f,fs.readFileSync(TPL,'utf8').replace('__CFG__',()=>JSON.stringify(C)));console.log(`${f} gravado · ${Object.keys(C.users).length} usuário(s) · ${(fs.statSync(f).size/1e6).toFixed(1)} MB`);}
(async()=>{const idx=O.index||O.saida||'index.html';
  if(cmd==='criar'){need('painel','usuario','senha');const K=rnd(32);const C={v:1,iter:ITER,users:{},...await cifrarPainel(K,O.painel)};C.users[await uid(O.usuario)]=await wrap(K,O.senha);gravar(idx,C);}
  else if(cmd==='adicionar'){need('admin','senha-admin','usuario','senha');const C=ler(idx);const K=await unwrap(C,O.admin,O['senha-admin']);C.users[await uid(O.usuario)]=await wrap(K,O.senha);gravar(idx,C);}
  else if(cmd==='remover'){need('admin','senha-admin','usuario');const C=ler(idx);await unwrap(C,O.admin,O['senha-admin']);const id=await uid(O.usuario);if(!C.users[id])fail('usuário não encontrado');delete C.users[id];gravar(idx,C);}
  else if(cmd==='senha'){need('usuario','senha','nova');const C=ler(idx);const K=await unwrap(C,O.usuario,O.senha);C.users[await uid(O.usuario)]=await wrap(K,O.nova);gravar(idx,C);}
  else if(cmd==='atualizar'){need('admin','senha-admin','painel');const C=ler(idx);const K=await unwrap(C,O.admin,O['senha-admin']);Object.assign(C,await cifrarPainel(K,O.painel));gravar(idx,C);}
  else if(cmd==='listar'){const C=ler(idx);console.log(Object.keys(C.users).length+' usuário(s) cadastrados (os nomes ficam guardados só como hash).');}
  else fail('comando: criar | adicionar | remover | senha | atualizar | listar');
})();
