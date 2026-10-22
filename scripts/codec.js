// Formato binário colunar do painel: "VSD1" + uint32 tamanho do cabeçalho + cabeçalho JSON + colunas alinhadas a 8 bytes; tudo em gzip.
const zlib=require('zlib');
const TIPOS={Int8Array:[1,-128,127],Uint8Array:[1,0,255],Int16Array:[2,-32768,32767],Uint16Array:[2,0,65535],Int32Array:[4,-2147483648,2147483647],Uint32Array:[4,0,4294967295]};
function tipoDe(a,forcar){if(forcar)return forcar;let mn=Infinity,mx=-Infinity,int=true;for(const v of a){if(v<mn)mn=v;if(v>mx)mx=v;if(int&&!Number.isInteger(v))int=false;}
  if(!a.length)return'Uint8Array';if(!int)return(Math.abs(mx)<1e6&&Math.abs(mn)<1e6)?'Float32Array':'Float64Array';
  for(const k of['Uint8Array','Int8Array','Uint16Array','Int16Array','Uint32Array','Int32Array']){const[,lo,hi]=TIPOS[k];if(mn>=lo&&mx<=hi)return k;}return'Float64Array';}
function codificar(D,forcar={}){const cols=[],bufs=[];let off=0;
  const add=(o,k,a)=>{let arr=a,key=k;if(o==='P'&&k==='eo'){arr=new Uint8Array(a.length-1);for(let i=0;i+1<a.length;i++)arr[i]=Math.min(255,a[i+1]-a[i]);key='eoN';}
    const tp=tipoDe(arr,forcar[o+'.'+k]);const T=global[tp];const ta=T.from(arr);const b=Buffer.from(ta.buffer,ta.byteOffset,ta.byteLength);
    const pad=(8-(off%8))%8;if(pad){bufs.push(Buffer.alloc(pad));off+=pad;}cols.push({o,k:key,tp,n:ta.length,off});bufs.push(b);off+=b.length;};
  for(const k of Object.keys(D.P))add('P',k,D.P[k]);
  const Eextra={};for(const k of Object.keys(D.E)){const a=D.E[k];if(Array.isArray(a)&&a.every(v=>typeof v==='number'))add('E',k,a);else Eextra[k]=a;}
  const head=Buffer.from(JSON.stringify({meta:D.meta,Eextra,cols}),'utf8');const h4=Buffer.alloc(8);h4.write('VSD1',0);h4.writeUInt32LE(head.length,4);
  let pre=Buffer.concat([h4,head]);const pad=(8-(pre.length%8))%8;pre=Buffer.concat([pre,Buffer.alloc(pad)]);
  return zlib.gzipSync(Buffer.concat([pre,...bufs]),{level:9});}
function decodificar(buf){const u=new Uint8Array(buf);const dv=new DataView(u.buffer,u.byteOffset);if(String.fromCharCode(u[0],u[1],u[2],u[3])!=='VSD1')throw new Error('formato');
  const hl=dv.getUint32(4,true);const H=JSON.parse(new TextDecoder().decode(u.subarray(8,8+hl)));let base=8+hl;base+=(8-(base%8))%8;
  const D={meta:H.meta,P:{},E:Object.assign({},H.Eextra)};
  for(const c of H.cols){const T=global[c.tp];const a=new T(u.buffer.slice(u.byteOffset+base+c.off,u.byteOffset+base+c.off+c.n*T.BYTES_PER_ELEMENT));
    if(c.k==='eoN'){const eo=new Uint32Array(c.n+1);for(let i=0;i<c.n;i++)eo[i+1]=eo[i]+a[i];D[c.o].eo=eo;}else D[c.o][c.k]=a;}
  return D;}
module.exports={codificar,decodificar};
