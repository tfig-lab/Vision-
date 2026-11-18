// trocar: cifra um painel novo dentro do index.html existente (mesma chave, mesmos usuários, mesma tela de login)
//   node painel_tool.js trocar <index.html> <painel.html> <usuario> <senha>
// local: gera um arquivo local com login a partir da mesma tela, chave nova e um usuário
//   node painel_tool.js local <index.html> <painel_aberto.html> <usuario> <senha> <saida.html>
const fs=require('fs'),zlib=require('zlib');const wc=require('crypto').webcrypto,subtle=wc.subtle;const enc=new TextEncoder();
const ub=s=>new Uint8Array(Buffer.from(s,'base64')),b64=u=>Buffer.from(u).toString('base64'),rnd=n=>wc.getRandomValues(new Uint8Array(n));
const RX=/(<script id="cfg" type="application\/json">)([\s\S]*?)(<\/script>)/;
const uid=async u=>Buffer.from(await subtle.digest('SHA-256',enc.encode('vision:'+u.trim().toLowerCase()))).toString('hex');
async function kek(pw,salt,it){const b=await subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveKey']);return subtle.deriveKey({name:'PBKDF2',salt,iterations:it,hash:'SHA-256'},b,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
const pagina=h=>/^\s*<!doctype/i.test(h)?h:'<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'+h+'\n</html>\n';
async function cifra(K,html){const gz=zlib.gzipSync(Buffer.from(pagina(html),'utf8'),{level:9});const iv=rnd(12),k=await subtle.importKey('raw',K,'AES-GCM',false,['encrypt']);return{iv:b64(iv),ct:b64(new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv},k,gz)))};}
(async()=>{const [cmd,idx,painel,usr,pw,saida]=process.argv.slice(2);const t=fs.readFileSync(idx,'utf8');const C=JSON.parse(t.match(RX)[2]);const html=fs.readFileSync(painel,'utf8');
 if(cmd==='trocar'){const e=C.users[await uid(usr)];if(!e)throw new Error('usuário não encontrado');const K=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:ub(e.iv)},await kek(pw,ub(e.s),C.iter),ub(e.k)));
   Object.assign(C,await cifra(K,html));fs.writeFileSync(idx,t.replace(RX,(m,a,b,c)=>a+JSON.stringify(C)+c));console.log(idx,'atualizado',(fs.statSync(idx).size/1e6).toFixed(1),'MB ·',Object.keys(C.users).length,'usuário(s)');}
 else if(cmd==='local'){const K=rnd(32),s=rnd(16),iv=rnd(12);const k=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv},await kek(pw,s,C.iter),K));
   const N={...C,users:{[await uid(usr)]:{s:b64(s),iv:b64(iv),k:b64(k)}},...await cifra(K,html)};fs.writeFileSync(saida,t.replace(RX,(m,a,b,c)=>a+JSON.stringify(N)+c));console.log(saida,'gravado',(fs.statSync(saida).size/1e6).toFixed(1),'MB');}})().catch(e=>{console.error('Erro:',e.message);process.exit(1);});
