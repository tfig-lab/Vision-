/* Processamento completo no navegador (porte do pipeline5.py).
   Entrada: texto do CSV de interações, texto do CSV de velocidade, mapa {Event Code -> Consolidação Operação} (ou null), parâmetros.
   Saída: {meta, P, E} no mesmo formato usado pelo painel. */
function rodarPipeline(txtInter, txtVel, gmap, prm, progresso){
const listaI=Array.isArray(txtInter)?txtInter:[txtInter],listaV=Array.isArray(txtVel)?txtVel:[txtVel];
'use strict';
const PRE=prm.pre??5, POS=prm.pos??20, TOL=prm.tol??3, LIM_PARADA=prm.parada??600;
const SEM_GRUPO='Sem grupo na planilha';
const log=(msg,f)=>{if(progresso)progresso(msg,f);};
const NaN_=NaN;

/* ---------- utilidades ---------- */
function linhas(txt){if(txt.charCodeAt(0)===0xFEFF)txt=txt.slice(1);return txt.split(/\r?\n/);}
function campos(l){if(l.indexOf('"')<0)return l.split(';');const out=[];let cur='',q=false;for(let i=0;i<l.length;i++){const c=l[i];if(c==='"'){if(q&&l[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===';'&&!q){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}
const num=s=>{if(s==null)return NaN;s=String(s).trim();if(!s||s==='NULL')return NaN;return +s.replace(',', '.');};
const vazio=s=>s==null||String(s).trim()===''||String(s).trim()==='NULL';
function tms(s){ // 'YYYY-MM-DD HH:MM:SS.fff' -> ms (relógio da base, sem fuso)
  if(vazio(s))return NaN;const m=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(String(s).trim());if(!m)return NaN;
  return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6],m[7]?Math.round(+('0.'+m[7])*1000):0);}
const fmt=(ms,sec)=>{const d=new Date(ms),p=n=>String(n).padStart(2,'0');return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${sec?':'+p(d.getUTCSeconds()):''}`;};
function median(a){const b=Float64Array.from(a).sort();const n=b.length;if(!n)return NaN;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;}
function quantile(sorted,p){return sorted[Math.min(sorted.length-1,Math.floor(p*sorted.length))];}
/* lat/lon (graus) -> SIRGAS 2000 / UTM 22S (série de Krüger) */
function utm22s(lon,lat){const a=6378137,f=1/298.257222101,k0=0.9996,lon0=-51*Math.PI/180;
  const n=f/(2-f),A=a/(1+n)*(1+n*n/4+n**4/64);
  const al=[n/2-2*n*n/3+5*n**3/16,13*n*n/48-3*n**3/5,61*n**3/240];
  const phi=lat*Math.PI/180,lam=lon*Math.PI/180-lon0,e=Math.sqrt(f*(2-f));
  const t=Math.sinh(Math.atanh(Math.sin(phi))-e*Math.atanh(e*Math.sin(phi)));
  const xi=Math.atan2(t,Math.cos(lam)),eta=Math.atanh(Math.sin(lam)/Math.sqrt(1+t*t));
  let E=eta,N=xi;for(let j=1;j<=3;j++){E+=al[j-1]*Math.cos(2*j*xi)*Math.sinh(2*j*eta);N+=al[j-1]*Math.sin(2*j*xi)*Math.cosh(2*j*eta);}
  return[500000+k0*A*E,10000000+k0*A*N];}

/* ---------- 1. interações ---------- */
log('Lendo interações',0.02);
let linhasInter=0;const vistos=new Set();const EV=[];let frota='';
const diaDe=(s,t)=>{const m=/^(\d{4}-\d{2}-\d{2})/.exec(String(s||'').trim());if(m)return m[1];if(isNaN(t))return'';const d=new Date(t);return d.toISOString().slice(0,10);};
listaI.forEach((txt,fi)=>{const LI=linhas(txt);const hI=campos(LI[0]).map(s=>s.trim());const ci=n=>{const k=hI.indexOf(n);if(k<0)throw new Error(`Coluna "${n}" não encontrada no arquivo de interações ${listaI.length>1?'nº '+(fi+1):''}.`);return k;};
const cId=ci('Id_Evento_Origem'),cTag=ci('TAG'),cIni=ci('Data_Inicio'),cFim=ci('Data_Termino'),cLon=ci('Longitude'),cLat=ci('Latitude'),cTipo=ci('Tipo_Alerta'),cRaz=ci('Razao'),cDesc=hI.indexOf('Evento_Descricao'),cCod=ci('Evento_Codigo');
const cTurnoI=hI.indexOf('Turno'),cFrota=hI.indexOf('Frota'),cDR=hI.indexOf('Dt_Referencia');
for(let i=1;i<LI.length;i++){if(!LI[i])continue;linhasInter++;const c=campos(LI[i]);const key=c[cId]+'|'+c[cTag];if(vistos.has(key))continue;vistos.add(key);
  if(!frota&&cFrota>=0&&!vazio(c[cFrota]))frota=String(c[cFrota]).trim();
  const ini=tms(c[cIni]),fim=tms(c[cFim]);const fv=!isNaN(fim)&&new Date(fim).getUTCFullYear()>2000&&fim>=ini;
  const lon=num(c[cLon]),lat=num(c[cLat]);const[X,Y]=(isFinite(lon)&&isFinite(lat))?utm22s(lon,lat):[NaN,NaN];
  EV.push({id:c[cId],tag:String(c[cTag]).trim(),ini,fim,fv,dur:fv?(fim-ini)/1000:0,X,Y,tipo:String(c[cTipo]||'').trim(),razao:!vazio(c[cRaz])?String(c[cRaz]).trim():(cDesc>=0&&!vazio(c[cDesc])?String(c[cDesc]).trim():'(sem Razao)'),cod:String(c[cCod]||'').trim().toUpperCase(),turno:cTurnoI>=0?String(c[cTurnoI]).trim():'',dia:diaDe(cDR>=0?c[cDR]:'',ini)});}});
if(!EV.length)throw new Error('O arquivo de interações não tem linhas de dados.');

/* ---------- 2. velocidade ---------- */
log('Lendo velocidades',0.08);
let rows=[];let local='';const vistosV=new Set();
listaV.forEach((txt,fi)=>{const LV=linhas(txt);const hV=campos(LV[0]).map(s=>s.trim());const cv=n=>{const k=hV.indexOf(n);if(k<0)throw new Error(`Coluna "${n}" não encontrada no arquivo de velocidade ${listaV.length>1?'nº '+(fi+1):''}.`);return k;};
const vTag=cv('TAG'),vT=cv('Data_Leitura'),vX=cv('PosX'),vY=cv('PosY'),vZ=cv('PosZ'),vV=cv('Velocidade'),vH=cv('Direcao'),vNT=hV.indexOf('NomeTurno'),vLoc=hV.indexOf('Localidade'),vDR=hV.indexOf('Dt_Referencia');
for(let i=1;i<LV.length;i++){if(!LV[i])continue;const c=campos(LV[i]);const t=tms(c[vT]);const X=num(c[vX]),Y=num(c[vY]);if(isNaN(t)||!isFinite(X)||!isFinite(Y))continue;
  const tag=String(c[vTag]).trim();const key=tag+'|'+t;if(vistosV.has(key))continue;vistosV.add(key);
  if(!local&&vLoc>=0)local=String(c[vLoc]).trim();
  rows.push({tag,t,X,Y,z:num(c[vZ])/10,v:num(c[vV]),hd:num(c[vH]),turno:vNT>=0?String(c[vNT]).trim().split(/\s+/).pop():'',dia:diaDe(vDR>=0?c[vDR]:'',t)});}});
for(let i=0;i<listaI.length;i++)listaI[i]=null;for(let i=0;i<listaV.length;i++)listaV[i]=null; // libera o texto dos CSVs (memória)
if(!rows.length)throw new Error('O arquivo de velocidade não tem linhas de dados.');
rows.sort((a,b)=>a.tag<b.tag?-1:a.tag>b.tag?1:a.t-b.t);
const N=rows.length;const col=k=>Float64Array.from(rows,r=>r[k]);
const T=col('t'),X=col('X'),Y=col('Y'),Z=col('z'),V=col('v'),HD=col('hd');const TAGV=rows.map(r=>r.tag),TURNO=rows.map(r=>r.turno),DIAV=rows.map(r=>r.dia);rows=null;
const dias=[...new Set(DIAV)].sort();const diaIdx=Object.fromEntries(dias.map((d,k)=>[d,k]));
const tags=[...new Set(TAGV)].sort();const ti=Object.fromEntries(tags.map((t,k)=>[t,k]));const K=Int32Array.from(TAGV,t=>ti[t]);
const tagStart=new Int32Array(tags.length+1);{let k=0;for(let i=0;i<N;i++){while(k<K[i]){k++;tagStart[k]=i;}}for(let k2=K[N-1]+1;k2<=tags.length;k2++)tagStart[k2]=N;tagStart[0]=0;}
const same=(i,j)=>j>=0&&j<N&&K[i]===K[j];

/* ---------- 3. tempo, distância, rampa, curvatura ---------- */
log('Calculando rampa e curvatura',0.14);
const W=new Float64Array(N),DS=new Float64Array(N).fill(NaN),S=new Float64Array(N);
for(let i=0;i<N;i++){W[i]=same(i,i+1)?Math.min(20,(T[i+1]-T[i])/1000):10;if(same(i,i-1))DS[i]=Math.hypot(X[i]-X[i-1],Y[i]-Y[i-1]);S[i]=(same(i,i-1)?S[i-1]:0)+(isNaN(DS[i])?0:DS[i]);}
const G=new Float64Array(N).fill(NaN);
for(let i=0;i<N;i++){const p=same(i,i-1)?i-1:-1,n=same(i,i+1)?i+1:-1;let g=NaN;
  if(p>=0&&n>=0){const span=S[n]-S[p];if(span>=20&&span<=400)g=(Z[n]-Z[p])/span*100;}
  if(isNaN(g)&&p>=0){const one=DS[i];if(one>=15&&one<=300)g=(Z[i]-Z[p])/one*100;}
  if(Math.abs(g)>20)g=NaN;G[i]=g;}
const SEC=Int8Array.from(HD,h=>Math.floor((((h+22.5)%360)+360)%360/45));
const CELL20=new Array(N);for(let i=0;i<N;i++)CELL20[i]=Math.floor(X[i]/20)+'_'+Math.floor(Y[i]/20);
{const acc=new Map();for(let i=0;i<N;i++){if(isNaN(G[i]))continue;const k=CELL20[i]+'|'+SEC[i];let a=acc.get(k);if(!a){a=[];acc.set(k,a);}a.push(G[i]);}
 const med=new Map();acc.forEach((a,k)=>med.set(k,median(a)));
 for(let i=0;i<N;i++){if(!isNaN(G[i]))continue;const m1=med.get(CELL20[i]+'|'+SEC[i]);if(m1!=null&&!isNaN(m1)){G[i]=m1;continue;}const m2=med.get(CELL20[i]+'|'+((SEC[i]+4)%8));if(m2!=null&&!isNaN(m2))G[i]=-m2;}}
const CURV=new Float64Array(N).fill(NaN);
for(let i=0;i<N;i++){if(!same(i,i-1)||!same(i,i+1))continue;const dh=((((HD[i+1]-HD[i-1]+180)%360)+360)%360)-180;const dd=(isNaN(DS[i])?0:DS[i])+(isNaN(DS[i+1])?0:DS[i+1]);if(dd>8)CURV[i]=Math.min(120,Math.abs(dh)/dd*100);}

/* ---------- 4. cheio / vazio ---------- */
log('Inferindo cheio e vazio',0.2);
const CICLO=EV.filter(e=>e.razao==='AT is in Loading'||e.razao==='AT is in Dumping');
const CARGA=new Int8Array(N).fill(2); // 0 cheio, 1 vazio, 2 indefinido
{const porTag=new Map();CICLO.forEach(e=>{if(!(e.tag in ti))return;(porTag.get(e.tag)||porTag.set(e.tag,[]).get(e.tag)).push(e);});
 porTag.forEach((lst,tag)=>{const k=ti[tag];const byFim=lst.map(e=>({t:e.fv?e.fim:e.ini,s:e.razao==='AT is in Loading'?0:1})).sort((a,b)=>a.t-b.t);
  const byIni=lst.map(e=>({t:e.ini,s:e.razao==='AT is in Loading'?1:0})).sort((a,b)=>a.t-b.t);
  let p=-1,q=0;for(let i=tagStart[k];i<tagStart[k+1];i++){while(p+1<byFim.length&&byFim[p+1].t<=T[i])p++;while(q<byIni.length&&byIni[q].t<T[i])q++;
   CARGA[i]=p>=0?byFim[p].s:(q<byIni.length?byIni[q].s:2);}});}

/* ---------- 5. interações do modelo (Razao com grupo) ---------- */
log('Associando interações às leituras',0.26);
const comRazao=EV.filter(e=>e.razao);const semRazao=EV.length-comRazao.length;
comRazao.forEach(e=>{e.grupo=gmap?(gmap[e.cod]||SEM_GRUPO):SEM_GRUPO;e.par=e.grupo+' | '+(e.cod||'—')+' | '+e.razao;});
const usaGrupo=!!gmap;
// "AT is moving." só indica que o caminhão voltou a andar: não é interação, não entra no impacto nem bloqueia leituras limpas
const NAO_IMPACTO=/^AT is moving\.?$/i;
const EM=comRazao.filter(e=>!NAO_IMPACTO.test(e.razao.trim())); // demais interações (Razao + código) entram; as sem grupo no de-para ficam em SEM_GRUPO
const eventosFora=comRazao.length-EM.length;
const contPar=new Map();EM.forEach(e=>contPar.set(e.par,(contPar.get(e.par)||0)+1));
const pares=[...contPar.keys()].sort((a,b)=>contPar.get(b)-contPar.get(a)||(a<b?-1:1));const pi=Object.fromEntries(pares.map((p,k)=>[p,k]));
{const md=new Map();EM.forEach(e=>{if(e.fv)(md.get(e.par)||md.set(e.par,[]).get(e.par)).push(e.dur);});const mm=new Map();md.forEach((a,k)=>mm.set(k,median(a)));
 EM.forEach(e=>{e.pi=pi[e.par];e.du=Math.min(1200,Math.max(0,e.fv?e.dur:(mm.get(e.par)??0)));e.a=e.ini-PRE*1000;e.b=e.ini+(e.du+POS)*1000;});}
const ATIVOS=Array.from({length:N},()=>[]);
function faixa(k,a,b){let lo=tagStart[k],hi=tagStart[k+1];let l=lo,h=hi;while(l<h){const m=(l+h)>>1;if(T[m]<a)l=m+1;else h=m;}const s=l;l=s;h=hi;while(l<h){const m=(l+h)>>1;if(T[m]<=b)l=m+1;else h=m;}return[s,l];}
EM.forEach(e=>{if(!(e.tag in ti))return;const[s,f]=faixa(ti[e.tag],e.a,e.b);for(let i=s;i<f;i++)ATIVOS[i].push(e.pi);});
for(let i=0;i<N;i++)if(ATIVOS[i].length>1)ATIVOS[i]=[...new Set(ATIVOS[i])].sort((a,b)=>a-b);
const NAT=Int32Array.from(ATIVOS,a=>a.length);

/* ---------- 6. paradas longas ---------- */
const LP=new Uint8Array(N);
{let i=0;while(i<N){const st=V[i]<1;let j=i;let soma=0;while(j<N&&K[j]===K[i]&&(V[j]<1)===st){soma+=W[j];j++;}if(st&&soma>=LIM_PARADA)for(let q=i;q<j;q++)LP[q]=1;i=j;}}

/* ---------- 7. velocidade de referência: gradient boosting (perda absoluta), fora da amostra por caminhão ---------- */
const NF=8;const FEAT=[X,Y,Float64Array.from(HD,h=>Math.sin(h*Math.PI/180)),Float64Array.from(HD,h=>Math.cos(h*Math.PI/180)),G,Float64Array.from(CARGA,c=>c===0?1:0),CURV,Z];
const NB=64;const BIN=FEAT.map(()=>new Uint8Array(N));
FEAT.forEach((f,j)=>{const vals=[];for(let i=0;i<N;i++)if(!isNaN(f[i]))vals.push(f[i]);vals.sort((a,b)=>a-b);const th=[];for(let b=1;b<NB-1;b++){const v=vals[Math.floor(b*vals.length/(NB-1))];if(!th.length||v>th[th.length-1])th.push(v);}
  for(let i=0;i<N;i++){const v=f[i];if(isNaN(v)){BIN[j][i]=0;continue;}let l=0,h=th.length;while(l<h){const m=(l+h)>>1;if(v>th[m])l=m+1;else h=m;}BIN[j][i]=l+1;}});
function quickMedian(arr,n){if(!n)return 0;const a=arr.slice(0,n);a.sort();return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;}
function treinarGBM(idx,y,opt){const n=idx.length,lr=opt.lr,maxIt=opt.it,minLeaf=opt.minLeaf,maxLeaves=opt.leaves;
  // separa 10% para parada antecipada
  const perm=Int32Array.from(idx);let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
  for(let i=n-1;i>0;i--){const j=Math.floor(rnd()*(i+1));const t=perm[i];perm[i]=perm[j];perm[j]=t;}
  const nv=Math.floor(n*0.1),VAL=perm.subarray(0,nv),TR=perm.subarray(nv);const nt=TR.length;
  const ytr=Float64Array.from(TR,i=>y[i]);const f0=quickMedian(Float64Array.from(ytr),nt);
  const Ftr=new Float64Array(nt).fill(f0),Fval=new Float64Array(nv).fill(f0);const trees=[];
  const g=new Float64Array(nt),res=new Float64Array(nt);let best=Infinity,bestIt=0,semMelhora=0;
  const yval=Float64Array.from(VAL,i=>y[i]);
  for(let it=0;it<maxIt;it++){
    for(let r=0;r<nt;r++){res[r]=ytr[r]-Ftr[r];g[r]=res[r]>0?-1:(res[r]<0?1:0);}
    const tree=construirArvore(TR,g,minLeaf,maxLeaves);
    // valor da folha = mediana do resíduo × taxa
    const porFolha=new Map();for(let r=0;r<nt;r++){const lf=tree.leafOf[r];(porFolha.get(lf)||porFolha.set(lf,[]).get(lf)).push(res[r]);}
    tree.nodes.forEach((nd,id)=>{if(nd.leaf){const a=porFolha.get(id)||[];nd.val=lr*(a.length?median(a):0);}});
    for(let r=0;r<nt;r++)Ftr[r]+=tree.nodes[tree.leafOf[r]].val;
    let mae=0;for(let r=0;r<nv;r++){Fval[r]+=preverArvore(tree.nodes,VAL[r]);mae+=Math.abs(yval[r]-Fval[r]);}mae/=Math.max(1,nv);
    trees.push(tree.nodes);
    if(mae<best-1e-7){best=mae;bestIt=it+1;semMelhora=0;}else if(++semMelhora>=10)break;}
  return{f0,trees:trees.slice(0,bestIt||trees.length)};}
function construirArvore(TR,g,minLeaf,maxLeaves){const nt=TR.length;const leafOf=new Int32Array(nt);const nodes=[{leaf:true,rows:Int32Array.from({length:nt},(_,i)=>i)}];
  const hist=(rows)=>{const H=new Float64Array(NF*NB*2);for(let q=0;q<rows.length;q++){const r=rows[q],i=TR[r],gv=g[r];for(let j=0;j<NF;j++){const o=(j*NB+BIN[j][i])*2;H[o]+=gv;H[o+1]++;}}return H;};
  const melhor=(nd)=>{const rows=nd.rows,n=rows.length;if(n<2*minLeaf)return null;const H=nd.H||(nd.H=hist(rows));let Gs=0;for(let q=0;q<rows.length;q++)Gs+=g[rows[q]];
    let bg=1e-9,bj=-1,bb=-1,bnan=0;const base=Gs*Gs/n;
    for(let j=0;j<NF;j++){const gN=H[(j*NB)*2],cN=H[(j*NB)*2+1];let gl=0,cl=0;
      for(let b=1;b<NB-1;b++){gl+=H[(j*NB+b)*2];cl+=H[(j*NB+b)*2+1];
        for(const nanEsq of[0,1]){const GL=gl+(nanEsq?gN:0),CL=cl+(nanEsq?cN:0),GR=Gs-GL,CR=n-CL;if(CL<minLeaf||CR<minLeaf)continue;const ga=GL*GL/CL+GR*GR/CR-base;if(ga>bg){bg=ga;bj=j;bb=b;bnan=nanEsq;}}}}
    return bj<0?null:{gain:bg,j:bj,b:bb,nan:bnan};};
  let folhas=1;const cand=[0];nodes[0].best=melhor(nodes[0]);
  while(folhas<maxLeaves){let bi=-1,bgv=0;for(const id of cand){const b=nodes[id].best;if(b&&b.gain>bgv){bgv=b.gain;bi=id;}}if(bi<0)break;
    const nd=nodes[bi],sp=nd.best;const L=[],Rr=[];for(let q=0;q<nd.rows.length;q++){const r=nd.rows[q],bv=BIN[sp.j][TR[r]];if(bv===0?sp.nan:bv<=sp.b)L.push(r);else Rr.push(r);}
    const li=nodes.length,ri=li+1;nodes.push({leaf:true,rows:Int32Array.from(L)},{leaf:true,rows:Int32Array.from(Rr)});
    // truque da subtração de histogramas
    const peq=L.length<=Rr.length?li:ri,gr=peq===li?ri:li;nodes[peq].H=hist(nodes[peq].rows);const Hg=new Float64Array(nd.H.length);for(let q=0;q<Hg.length;q++)Hg[q]=nd.H[q]-nodes[peq].H[q];nodes[gr].H=Hg;
    Object.assign(nd,{leaf:false,j:sp.j,b:sp.b,nan:sp.nan,l:li,r:ri});delete nd.rows;delete nd.H;delete nd.best;
    cand.splice(cand.indexOf(bi),1);cand.push(li,ri);nodes[li].best=melhor(nodes[li]);nodes[ri].best=melhor(nodes[ri]);folhas++;}
  nodes.forEach((nd,id)=>{if(nd.leaf){for(let q=0;q<nd.rows.length;q++)leafOf[nd.rows[q]]=id;delete nd.rows;delete nd.H;delete nd.best;}});
  return{nodes,leafOf};}
function preverArvore(nodes,i){let id=0;for(;;){const nd=nodes[id];if(nd.leaf)return nd.val;const bv=BIN[nd.j][i];id=(bv===0?nd.nan:bv<=nd.b)?nd.l:nd.r;}}
const preverModelo=(m,i)=>{let s=m.f0;for(const t of m.trees)s+=preverArvore(t,i);return s;};
const LIMPO=new Uint8Array(N);for(let i=0;i<N;i++)LIMPO[i]=(NAT[i]===0&&V[i]>=2&&!LP[i])?1:0;
const VREF=new Float64Array(N);const cvs=[];
{const nf=Math.min(5,tags.length);const foldOf=k=>k%nf; // GroupKFold por caminhão
 for(let f=0;f<nf;f++){log(`Treinando velocidade de referência (${f+1}/${nf})`,0.32+0.4*f/nf);
  const tr=[];for(let i=0;i<N;i++)if(LIMPO[i]&&foldOf(K[i])!==f)tr.push(i);
  if(tr.length>60000){let sd=11;const rr=()=>{sd=(sd*1103515245+12345)&0x7fffffff;return sd/0x7fffffff;};for(let q=tr.length-1;q>0;q--){const j=Math.floor(rr()*(q+1));const t_=tr[q];tr[q]=tr[j];tr[j]=t_;}tr.length=60000;} // muitos dias: amostra fixa para manter o tempo
  const m=treinarGBM(tr,V,{lr:0.15,it:200,minLeaf:30,leaves:63});
  let ae=0,se=0,sy=0,sy2=0,nn=0;
  for(let i=0;i<N;i++){if(foldOf(K[i])!==f)continue;VREF[i]=preverModelo(m,i);if(LIMPO[i]){const r=V[i]-VREF[i];ae+=Math.abs(r);se+=r*r;sy+=V[i];sy2+=V[i]*V[i];nn++;}}
  cvs.push({mae:ae/nn,r2:1-se/(sy2-sy*sy/nn)});}}
for(let i=0;i<N;i++)VREF[i]=Math.max(2,VREF[i]);
// referência = 0 durante AT is in Loading / AT is in Dumping (do início ao término)
{const md=new Map();CICLO.forEach(e=>{if(e.fv)(md.get(e.razao)||md.set(e.razao,[]).get(e.razao)).push(e.dur);});const mm=new Map();md.forEach((a,k)=>mm.set(k,median(a)));
 CICLO.forEach(e=>{if(!(e.tag in ti))return;const du=Math.min(1200,Math.max(0,e.fv?e.dur:(mm.get(e.razao)??0)));const[s,f]=faixa(ti[e.tag],e.ini,e.ini+du*1000);for(let i=s;i<f;i++)VREF[i]=0;});}

/* ---------- 8. perdas ---------- */
log('Calculando perdas',0.75);
const PERDA=new Float64Array(N);
for(let i=0;i<N;i++){const d=VREF[i]-V[i];const fr=d>TOL?Math.min(1,Math.max(0,d/VREF[i])):0;PERDA[i]=LP[i]?0:W[i]*fr;}

/* ---------- 9. estatística ---------- */
log('Rodando regressões',0.8);
function resolver(A,b,k){ // Gauss-Jordan com pivô; retorna inversa e solução
  const M=new Float64Array(k*2*k);for(let r=0;r<k;r++){for(let c=0;c<k;c++)M[r*2*k+c]=A[r*k+c];M[r*2*k+k+r]=1;}
  for(let c=0;c<k;c++){let p=c,mx=Math.abs(M[c*2*k+c]);for(let r=c+1;r<k;r++){const v=Math.abs(M[r*2*k+c]);if(v>mx){mx=v;p=r;}}if(mx<1e-12)return null;
    if(p!==c)for(let q=0;q<2*k;q++){const t=M[c*2*k+q];M[c*2*k+q]=M[p*2*k+q];M[p*2*k+q]=t;}
    const d=M[c*2*k+c];for(let q=0;q<2*k;q++)M[c*2*k+q]/=d;
    for(let r=0;r<k;r++){if(r===c)continue;const fct=M[r*2*k+c];if(!fct)continue;for(let q=0;q<2*k;q++)M[r*2*k+q]-=fct*M[c*2*k+q];}}
  const inv=new Float64Array(k*k);for(let r=0;r<k;r++)for(let c=0;c<k;c++)inv[r*k+c]=M[r*2*k+k+c];
  const x=new Float64Array(k);for(let r=0;r<k;r++){let s=0;for(let c=0;c<k;c++)s+=inv[r*k+c]*b[c];x[r]=s;}return{inv,x};}
const Phi=z=>{const t=1/(1+0.2316419*Math.abs(z)),d=0.3989423*Math.exp(-z*z/2);const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>0?1-p:p;};
function ols(cols,y,grp,clu,comConst){ // cols: arrays (n); retorna coef, ep agrupado, r2
  const k0=cols.length,k=k0+(comConst?1:0),n=y.length;const get=(c,i)=>c<k0?cols[c][i]:1;
  const XtX=new Float64Array(k*k),Xty=new Float64Array(k);const xi=new Float64Array(k);
  for(let i=0;i<n;i++){for(let c=0;c<k;c++)xi[c]=get(c,i);for(let a=0;a<k;a++){const v=xi[a];if(!v)continue;Xty[a]+=v*y[i];for(let b=a;b<k;b++)XtX[a*k+b]+=v*xi[b];}}
  for(let a=0;a<k;a++)for(let b=0;b<a;b++)XtX[a*k+b]=XtX[b*k+a];
  const sol=resolver(XtX,Xty,k);if(!sol)return null;const beta=sol.x;
  let sse=0,ym=0;for(let i=0;i<n;i++)ym+=y[i];ym/=n;let sst=0;const u=new Float64Array(n);
  for(let i=0;i<n;i++){let p=0;for(let c=0;c<k;c++)p+=beta[c]*get(c,i);u[i]=y[i]-p;sse+=u[i]*u[i];sst+=(y[i]-ym)**2;}
  let ep=null;if(clu){const gsum=new Map();for(let i=0;i<n;i++){let s=gsum.get(clu[i]);if(!s){s=new Float64Array(k);gsum.set(clu[i],s);}for(let c=0;c<k;c++)s[c]+=get(c,i)*u[i];}
    const Mm=new Float64Array(k*k);gsum.forEach(s=>{for(let a=0;a<k;a++)for(let b=0;b<k;b++)Mm[a*k+b]+=s[a]*s[b];});const Gc=gsum.size,adj=Gc/(Gc-1)*(n-1)/(n-k);
    const inv=sol.inv;const tmp=new Float64Array(k*k);for(let a=0;a<k;a++)for(let b=0;b<k;b++){let s=0;for(let c=0;c<k;c++)s+=inv[a*k+c]*Mm[c*k+b];tmp[a*k+b]=s;}
    ep=new Float64Array(k);for(let a=0;a<k;a++){let s=0;for(let c=0;c<k;c++)s+=tmp[a*k+c]*inv[c*k+a];ep[a]=Math.sqrt(Math.max(0,s*adj));}}
  return{beta,ep,r2:1-sse/sst,sse,sst};}
const tabela=(nomes,res,offset,exp)=>nomes.map((nm,j)=>{const c=res.beta[j+offset],e=res.ep[j+offset];return{nome:nm,coef:c,lo:c-1.959964*e,hi:c+1.959964*e,p:2*(1-Phi(Math.abs(c/e))),exp_h:exp?exp[j]:null};});
// base da regressão
const RI=[];for(let i=0;i<N;i++)if(!LP[i]&&!isNaN(G[i]))RI.push(i);const nR=RI.length;
const curvMed=new Map();{const acc=new Map();for(const i of RI){if(isNaN(CURV[i]))continue;(acc.get(CELL20[i])||acc.set(CELL20[i],[]).get(CELL20[i])).push(CURV[i]);}acc.forEach((a,k)=>curvMed.set(k,median(a)));}
const curvFE=Float64Array.from(RI,i=>isNaN(CURV[i])?(curvMed.get(CELL20[i])??0):CURV[i]),curv0=Float64Array.from(RI,i=>isNaN(CURV[i])?0:CURV[i]);
const ch=Float64Array.from(RI,i=>CARGA[i]===0?1:0),gr=Float64Array.from(RI,i=>G[i]);
const pista=(cv_)=>[Float64Array.from(gr,(g,j)=>Math.max(g,0)*ch[j]),Float64Array.from(gr,(g,j)=>Math.max(g,0)*(1-ch[j])),Float64Array.from(gr,(g,j)=>Math.max(-g,0)*ch[j]),Float64Array.from(gr,(g,j)=>Math.max(-g,0)*(1-ch[j])),ch,cv_];
const yR=Float64Array.from(RI,i=>V[i]),cluR=Int32Array.from(RI,i=>K[i]),wR=Float64Array.from(RI,i=>W[i]);
const grpKey=RI.map(i=>Math.floor(X[i]/25)+'_'+Math.floor(Y[i]/25)+'_'+SEC[i]);const gid=new Map();const GID=Int32Array.from(grpKey,k=>gid.has(k)?gid.get(k):(gid.set(k,gid.size),gid.size-1));
const gN=new Float64Array(gid.size);for(let r=0;r<nR;r++)gN[GID[r]]++;
const demean=a=>{const s=new Float64Array(gid.size);for(let r=0;r<nR;r++)s[GID[r]]+=a[r];const o=new Float64Array(nR);for(let r=0;r<nR;r++)o[r]=a[r]-s[GID[r]]/gN[GID[r]];return o;};
const okIdx=[];for(let r=0;r<nR;r++)if(gN[GID[r]]>1)okIdx.push(r);
const sub=a=>Float64Array.from(okIdx,r=>a[r]);
const parSet=q=>{const a=new Float64Array(nR);for(let r=0;r<nR;r++)if(ATIVOS[RI[r]].includes(q))a[r]=1;return a;};
const grupos=[...new Set(EM.map(e=>e.grupo))].map(g=>({nome:g,n:EM.filter(e=>e.grupo===g).length})).sort((a,b)=>b.n-a.n||(a.nome<b.nome?-1:1));
const parGrupo=pares.map(p=>p.split(' | ')[0]);
const nomesPista=['Subida·cheio','Subida·vazio','Descida·cheio','Descida·vazio','Cheio','Curvatura'];
function feReg(dum,nomes){const F=pista(curvFE);const all=[...F,...dum].map(demean);const keep=all.map((c,j)=>j<6||okIdx.some(r=>c[r]!==0));
  const cols=all.filter((c,j)=>keep[j]).map(sub);const nm=[...nomesPista,...nomes].filter((n,j)=>keep[j]);const dumKeep=dum.filter((c,j)=>keep[j+6]);
  const res=ols(cols,sub(demean(yR)),null,sub(cluR),false);if(!res)return{tab:[],n:okIdx.length};
  const exp=[...Array(6).fill(null),...dumKeep.map(c=>{let s=0;for(let r=0;r<nR;r++)if(c[r]>0)s+=wR[r];return s/3600;})];
  return{tab:tabela(nm,res,0,exp),n:okIdx.length};}
const gruposReg=grupos.filter(g=>g.n>=10).map(g=>g.nome);
const dumGr=gruposReg.map(g=>{const qs=new Set(pares.map((p,q)=>parGrupo[q]===g?q:-1).filter(q=>q>=0));const a=new Float64Array(nR);for(let r=0;r<nR;r++)if(ATIVOS[RI[r]].some(q=>qs.has(q)))a[r]=1;return a;});
log('Rodando regressões (grupos)',0.84);
const regGrupo=gruposReg.length?feReg(dumGr,gruposReg):{tab:[]};
const topPares=pares.filter(p=>contPar.get(p)>=30).slice(0,60); // limita a regressão às 60 interações mais frequentes (memória)
log('Rodando regressões (Razao)',0.88);
const dumPar=topPares.map(p=>parSet(pi[p]));
const regPar=topPares.length?feReg(dumPar,topPares):{tab:[],n:okIdx.length};
// Shapley (sem efeito de local) e coeficientes da pista
const Pm=pista(curv0);
const r2=(cols)=>{const r=ols(cols,yR,null,null,true);return r?r.r2:0;};
const rp=r2(Pm),re_=dumPar.length?r2(dumPar):0,ra=dumPar.length?r2([...Pm,...dumPar]):rp;
let sstAll=0,ym=0;for(let r=0;r<nR;r++)ym+=yR[r];ym/=nR;const sg=new Float64Array(gid.size);for(let r=0;r<nR;r++)sg[GID[r]]+=yR[r];let sseFE=0;for(let r=0;r<nR;r++){sstAll+=(yR[r]-ym)**2;sseFE+=(yR[r]-sg[GID[r]]/gN[GID[r]])**2;}
const shap={pista:(rp+ra-re_)/2,inter:(re_+ra-rp)/2,total:ra,local:1-sseFE/sstAll};
const rPista=ols([...Pm,...dumPar],yR,null,cluR,true);
const nomesP=['Subida·cheio (por % de rampa)','Subida·vazio (por % de rampa)','Descida·cheio (por % de rampa)','Descida·vazio (por % de rampa)','Cheio (vs vazio)','Curvatura (por °/100 m)'];
const regPista=rPista?nomesP.map((nm,j)=>{const c=rPista.beta[j],e=rPista.ep[j];return{nome:nm,coef:c,lo:c-1.959964*e,hi:c+1.959964*e,p:2*(1-Phi(Math.abs(c/e)))};}):[];
// curva rampa x velocidade
const curva=[];{const acc=new Map();for(let i=0;i<N;i++){if(!LIMPO[i]||isNaN(G[i])||CARGA[i]===2)continue;const gb=Math.round(Math.max(-14,Math.min(14,G[i])));const k=CARGA[i]+'|'+gb;(acc.get(k)||acc.set(k,[]).get(k)).push(V[i]);}
 acc.forEach((a,k)=>{if(a.length<40)return;const[c,gb]=k.split('|');curva.push({carga:c==='0'?'Cheio':'Vazio',grade:+gb,med:median(a),n:a.length});});}

/* ---------- 10. ciclos ---------- */
log('Montando ciclos',0.93);
const T0=Math.floor(Math.min(...Array.from({length:tags.length},(_,k)=>T[tagStart[k]]))/3600000)*3600000;
const ciclos=[];
{const ld=CICLO.filter(e=>e.razao==='AT is in Loading'&&e.tag in ti).sort((a,b)=>a.tag<b.tag?-1:a.tag>b.tag?1:a.ini-b.ini);const dp=CICLO.filter(e=>e.razao==='AT is in Dumping');
 const porTag=new Map();ld.forEach(e=>(porTag.get(e.tag)||porTag.set(e.tag,[]).get(e.tag)).push(e.ini));
 [...porTag.keys()].sort().forEach(tag=>{const st=porTag.get(tag),k=ti[tag];for(let q=0;q+1<st.length;q++){const a=st[q],b=st[q+1];if((b-a)/1000<120)continue;const[s,f]=faixa(k,a,b-1);if(f-s<5)continue;
   const dps=dp.filter(e=>e.tag===tag&&e.ini>a&&e.ini<b).map(e=>e.ini);ciclos.push([k,Math.round((a-T0)/1000),Math.round((b-T0)/1000),dps.length?Math.round((Math.min(...dps)-T0)/1000):-1,diaIdx[DIAV[s]]]);}});}

/* ---------- 11. exportação ---------- */
log('Montando painel',0.97);
let x0=Infinity,y0=Infinity;for(let i=0;i<N;i++){if(X[i]<x0)x0=X[i];if(Y[i]<y0)y0=Y[i];}
const eo=new Int32Array(N+1),el=[];for(let i=0;i<N;i++){for(const q of ATIVOS[i])el.push(q);eo[i+1]=el.length;}
const turnoCod=s=>s==='Diurno'?0:s==='Noturno'?1:0;
const P={t:[],x:[],y:[],v:[],r:[],w:[],k:[],c:[],s:[],p:[],sc:[],g:[],lp:[],dr:[],eo:Array.from(eo),el};
for(let i=0;i<N;i++){P.t.push(Math.round((T[i]-T0)/1000));P.x.push(Math.round(X[i]-x0));P.y.push(Math.round(Y[i]-y0));P.v.push(Math.round(V[i]*10));P.r.push(Math.round(VREF[i]*10));P.w.push(Math.round(W[i]));
  P.k.push(K[i]);P.c.push(CARGA[i]);P.s.push(turnoCod(TURNO[i]));P.p.push(Math.round(PERDA[i]*10));P.sc.push(SEC[i]);P.g.push(isNaN(G[i])?-999:Math.round(G[i]*10));P.lp.push(LP[i]);P.dr.push(diaIdx[DIAV[i]]);}
const ordemT=['TRUCK_STOP','EXCEPTION','WARNING','LH_MODE','TRUCK_MOVING','NAV_STATUS','OP_MODE'];const tset=new Set(EM.map(e=>e.tipo));
const tipos=[...ordemT.filter(t=>tset.has(t)),...[...tset].filter(t=>!ordemT.includes(t)).sort()];
const E={tp:[],k:[],t:[],d:[],f:[],q:[],x:[],y:[],s:[],c:[],dr:[]};
EM.filter(e=>e.tag in ti).sort((a,b)=>a.ini-b.ini).forEach(e=>{const k=ti[e.tag];
  // carga na leitura mais próxima (até 60 s)
  let c=2,dr=diaIdx[e.dia]??-1;{let l=tagStart[k],h=tagStart[k+1];while(l<h){const m=(l+h)>>1;if(T[m]<e.ini)l=m+1;else h=m;}let best=-1,bd=60001;for(const j of[l-1,l])if(j>=tagStart[k]&&j<tagStart[k+1]){const d=Math.abs(T[j]-e.ini);if(d<bd){bd=d;best=j;}}if(best>=0){c=CARGA[best];if(dr<0)dr=diaIdx[DIAV[best]];}}
  E.tp.push(tipos.indexOf(e.tipo));E.k.push(k);E.t.push(Math.round((e.ini-T0)/100)/10);E.d.push(Math.round(e.du*10)/10);E.f.push(e.fv?1:0);E.q.push(e.pi);
  E.x.push(Math.round(e.X-x0));E.y.push(Math.round(e.Y-y0));E.s.push(turnoCod(e.turno));E.c.push(c);E.dr.push(dr<0?0:dr);});
const tiposPar=(()=>{const m=new Map();EM.forEach(e=>{let s=m.get(e.par);if(!s){s=new Set();m.set(e.par,s);}s.add(e.tipo);});return pares.map(p=>[...(m.get(p)||[])].sort());})();
let tmin=Infinity,tmax=-Infinity;for(let i=0;i<N;i++){if(T[i]<tmin)tmin=T[i];if(T[i]>tmax)tmax=T[i];}
let horas=0;for(let i=0;i<N;i++)horas+=W[i];
const meta={origem:[x0,y0],t0:fmt(T0,true),tags,tipos,local,frota,dias,arquivos:{inter:listaI.length,vel:listaV.length},
  pares:pares.map((p,q)=>({razao:p.split(' | ').slice(2).join(' | '),cod:p.split(' | ')[1],grupo:parGrupo[q],tipos:tiposPar[q],n:contPar.get(p)})),
  grupos,sem_grupo:SEM_GRUPO,reg_grupo:regGrupo.tab,eventos_sem_razao:semRazao,
  loadxy:CICLO.filter(e=>e.razao==='AT is in Loading'&&isFinite(e.X)).map(e=>[Math.round(e.X-x0),Math.round(e.Y-y0)]),
  dumpxy:CICLO.filter(e=>e.razao==='AT is in Dumping'&&isFinite(e.X)).map(e=>[Math.round(e.X-x0),Math.round(e.Y-y0)]),
  eventos_fora:eventosFora,periodo:[fmt(tmin),fmt(tmax)],tol:TOL,pre:PRE,pos:POS,cv:cvs,
  q:{linhas:linhasInter,eventos:EM.length,sem_fim:EM.filter(e=>!e.fv).length,pontos:N,horas:horas/3600,pts_limpos:LIMPO.reduce((a,b)=>a+b,0),pts_com_evento:NAT.reduce((a,b)=>a+(b>0),0),n_reg:regPar.n||0,pares:pares.length},
  reg_pista:regPista,reg_par:regPar.tab,shap,curva,ciclos,usa_grupo:usaGrupo};
log('Reconstruindo as seções físicas da pista',.97);
{const SF=secoesFisicas(P,meta,E);meta.secoes=SF.secoes;P.sid=SF.sid;E.sid=SF.eid;}
log('Pronto',1);
return{meta,P,E};}
// Seções físicas: reconstrói o eixo das pistas a partir do GPS e corta em retas, curvas, interseções e áreas de carga/basculamento.
function secoesFisicas(P,M,E,opt){
  opt=Object.assign({g:4,minHits:3,fecha:6,abre:5,buraco:2500,spur:70,raioCurva:150,minReta:50,minCurva:30,rInter:35,dMax:30},opt||{});
  const N=P.x.length,G=opt.g;let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(let i=0;i<N;i++){const x=P.x[i],y=P.y[i];if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y;}
  x0-=60;y0-=60;x1+=60;y1+=60;const NX=Math.ceil((x1-x0)/G)+1,NY=Math.ceil((y1-y0)/G)+1,id=(a,b)=>a*NY+b;
  const gx=x=>Math.round((x-x0)/G),gy=y=>Math.round((y-y0)/G);
  // 1) zonas de carga e basculamento (agrupamento dos eventos)
  const zonas=[];
  const agrupa=(pts,tipo)=>{const used=new Uint8Array(pts.length);
    for(let a=0;a<pts.length;a++){if(used[a])continue;const st=[a],mem=[];used[a]=1;
      while(st.length){const u=st.pop();mem.push(u);for(let b=0;b<pts.length;b++)if(!used[b]&&Math.hypot(pts[b][0]-pts[u][0],pts[b][1]-pts[u][1])<100){used[b]=1;st.push(b);}}
      let cx=0,cy=0;for(const u of mem){cx+=pts[u][0];cy+=pts[u][1];}cx/=mem.length;cy/=mem.length;let r=0;for(const u of mem)r=Math.max(r,Math.hypot(pts[u][0]-cx,pts[u][1]-cy));
      const ds=mem.map(u=>Math.hypot(pts[u][0]-cx,pts[u][1]-cy)).sort((a,b)=>a-b);const p90=ds[Math.floor(.9*(ds.length-1))];zonas.push({tipo,x:cx,y:cy,r:Math.min(140,Math.max(60,p90+40)),n:mem.length});}};
  agrupa([...(M.loadxy||[]),...(M.dumpxy||[])],'Pontas (Carga / Basc.)'); // carga e basculamento juntos: a mesma área costuma receber os dois eventos
  const naZona=(x,y)=>{for(let z=0;z<zonas.length;z++){const Z=zonas[z];if(Math.abs(x-Z.x)<Z.r&&Math.abs(y-Z.y)<Z.r&&Math.hypot(x-Z.x,y-Z.y)<Z.r)return z;}return -1;};
  // 2) ocupação: linhas entre leituras consecutivas do mesmo caminhão
  const hit=new Uint16Array(NX*NY);
  for(let i=1;i<N;i++){if(P.k[i]!==P.k[i-1]||P.t[i]-P.t[i-1]>40||P.v[i]<20||P.v[i-1]<20)continue;
    const ax=(P.x[i-1]-x0)/G,ay=(P.y[i-1]-y0)/G,bx=(P.x[i]-x0)/G,by=(P.y[i]-y0)/G,L=Math.hypot(bx-ax,by-ay);if(L*G>130)continue;
    const n=Math.max(1,Math.ceil(L));let last=-1;for(let s=0;s<=n;s++){const k=id(Math.round(ax+(bx-ax)*s/n),Math.round(ay+(by-ay)*s/n));if(k!==last){if(hit[k]<65535)hit[k]++;last=k;}}}
  let road=new Uint8Array(NX*NY);for(let k=0;k<road.length;k++)road[k]=hit[k]>=opt.minHits?1:0;
  // fecha buracos (dilata 3, erode 2) e tira as zonas de carga/basculamento
  const dil=(src,r)=>{const o=new Uint8Array(src.length);for(let a=0;a<NX;a++)for(let b=0;b<NY;b++){if(!src[id(a,b)])continue;for(let da=-r;da<=r;da++)for(let db=-r;db<=r;db++){if(da*da+db*db>r*r)continue;const aa=a+da,bb=b+db;if(aa>=0&&bb>=0&&aa<NX&&bb<NY)o[id(aa,bb)]=1;}}return o;};
  const ero=(src,r)=>{const inv=new Uint8Array(src.length);for(let k=0;k<src.length;k++)inv[k]=src[k]?0:1;const d=dil(inv,r);for(let k=0;k<src.length;k++)d[k]=d[k]?0:1;return d;};
  road=ero(dil(road,opt.fecha),opt.abre);
  // preenche buracos pequenos (as duas mãos da pista viram uma faixa só)
  {const bg=new Int32Array(NX*NY).fill(-1);let c=0;for(let k0=0;k0<road.length;k0++){if(road[k0]||bg[k0]>=0)continue;const st=[k0],mem=[];bg[k0]=c;let borda=false;
    while(st.length){const k=st.pop();mem.push(k);const a=(k/NY)|0,b=k%NY;if(a===0||b===0||a===NX-1||b===NY-1)borda=true;for(const[da,db]of[[1,0],[-1,0],[0,1],[0,-1]]){const aa=a+da,bb=b+db;if(aa<0||bb<0||aa>=NX||bb>=NY)continue;const kk=id(aa,bb);if(!road[kk]&&bg[kk]<0){bg[kk]=c;st.push(kk);}}}
    if(!borda&&mem.length<opt.buraco)for(const k of mem)road[k]=1;c++;}}
  for(let a=0;a<NX;a++)for(let b=0;b<NY;b++)if(road[id(a,b)]&&naZona(x0+a*G,y0+b*G)>=0)road[id(a,b)]=0;
  // 3) esqueleto (Zhang-Suen)
  const sk=road;let mudou=true;const nb=(a,b)=>[sk[id(a,b+1)],sk[id(a+1,b+1)],sk[id(a+1,b)],sk[id(a+1,b-1)],sk[id(a,b-1)],sk[id(a-1,b-1)],sk[id(a-1,b)],sk[id(a-1,b+1)]];
  for(let a=0;a<NX;a++){sk[id(a,0)]=0;sk[id(a,NY-1)]=0;}for(let b=0;b<NY;b++){sk[id(0,b)]=0;sk[id(NX-1,b)]=0;}
  let ativos=[];for(let k=0;k<sk.length;k++)if(sk[k])ativos.push(k);
  while(mudou){mudou=false;for(const passo of[0,1]){const del=[];
    for(const k of ativos){if(!sk[k])continue;const a=(k/NY)|0,b=k%NY;const p=nb(a,b);let B=0,A=0;for(let j=0;j<8;j++){B+=p[j];if(!p[j]&&p[(j+1)%8])A++;}
      if(B<2||B>6||A!==1)continue;if(passo===0){if(p[0]*p[2]*p[4]||p[2]*p[4]*p[6])continue;}else{if(p[0]*p[2]*p[6]||p[0]*p[4]*p[6])continue;}del.push(k);}
    for(const k of del)sk[k]=0;if(del.length)mudou=true;}ativos=ativos.filter(k=>sk[k]);}
  // remove degraus (pixels de canto redundantes), deixando o esqueleto com 1 pixel de largura em 8-conectividade
  const OFF=[[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]];
  const comps=p=>{const on=[];for(let j=0;j<8;j++)if(p[j])on.push(j);const par=on.map((_,i)=>i);const f=i=>par[i]===i?i:(par[i]=f(par[i]));
    for(let u=0;u<on.length;u++)for(let v=u+1;v<on.length;v++){const A_=OFF[on[u]],B_=OFF[on[v]];if(Math.abs(A_[0]-B_[0])<=1&&Math.abs(A_[1]-B_[1])<=1)par[f(u)]=f(v);}
    let c=0;for(let u=0;u<on.length;u++)if(f(u)===u)c++;return[c,on.length];};
  for(const k of ativos){if(!sk[k])continue;const a=(k/NY)|0,b=k%NY;const p=nb(a,b);
    if(!((p[0]&&p[2])||(p[2]&&p[4])||(p[4]&&p[6])||(p[6]&&p[0])))continue;const[c,B]=comps(p);if(c===1&&B>=2)sk[k]=0;}
  ativos=ativos.filter(k=>sk[k]);
  // 4) grafo: nós (pontas e junções) e arestas
  const N8=[[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]];
  const viz=k=>{const a=(k/NY)|0,b=k%NY,o=[];for(const[da,db]of N8){const kk=id(a+da,b+db);if(sk[kk])o.push(kk);}return o;};
  let edges;
  const grafo=()=>{const deg=new Map();for(const k of ativos)if(sk[k])deg.set(k,viz(k).length);
    const isNode=k=>{const d=deg.get(k);return d===1||d>=3;};const seen=new Set(),E=[];
    for(const[k,d]of deg){if(!isNode(k))continue;for(const n0 of viz(k)){const key=k<n0?k+','+n0:n0+','+k;if(seen.has(key))continue;seen.add(key);
      const path=[k,n0];let prev=k,cur=n0;while(!isNode(cur)){const nx=viz(cur).filter(q=>q!==prev);if(!nx.length)break;
        // prefere vizinho 4-conectado para não pular cantos
        let nn=nx[0];prev=cur;cur=nn;const key2=prev<cur?prev+','+cur:cur+','+prev;if(seen.has(key2))break;seen.add(key2);path.push(cur);if(path.length>200000)break;}
      E.push({a:k,b:cur,path,da:deg.get(k),db:deg.get(cur)});}}
    // laços sem nó
    return E;};
  for(let it=0;it<5;it++){edges=grafo();let cut=0;for(const e of edges){const len=e.path.length*G;if((e.da===1||e.db===1)&&len<opt.spur){
      for(const k of e.path){if(k===e.a&&e.da>=3)continue;if(k===e.b&&e.db>=3)continue;sk[k]=0;cut++;}}}
    // re-afina depois do corte
    ativos=ativos.filter(k=>sk[k]);if(!cut)break;}
  edges=grafo().filter(e=>e.path.length*G>=12||(e.da>=3&&e.db>=3));
  // junções: agrupa pixels de grau>=3 próximos
  const jpx=[];for(const k of ativos){if(sk[k]&&viz(k).length>=3)jpx.push(k);}
  const juncs=[];for(const k of jpx){const x=x0+((k/NY)|0)*G,y=y0+(k%NY)*G;let J=juncs.find(j=>Math.hypot(j.x-x,j.y-y)<opt.rInter);if(J){J.n++;J.x+=(x-J.x)/J.n;J.y+=(y-J.y)/J.n;}else juncs.push({x,y,n:1});}
  // 5) cada aresta: reamostra a 5 m, suaviza, curvatura, classifica
  const secs=[];
  const pxy=k=>[x0+((k/NY)|0)*G,y0+(k%NY)*G];
  const perto=(x,y)=>juncs.findIndex(j=>Math.hypot(j.x-x,j.y-y)<opt.rInter);
  for(const e of edges){let pts=e.path.map(pxy);
    // suaviza 2x janela 5
    for(let r=0;r<3;r++){const q=pts.map((p,i)=>{let sx=0,sy=0,n=0;for(let d=-3;d<=3;d++){const j=Math.min(pts.length-1,Math.max(0,i+d));sx+=pts[j][0];sy+=pts[j][1];n++;}return[sx/n,sy/n];});q[0]=pts[0];q[q.length-1]=pts[pts.length-1];pts=q;}
    // reamostra cada 5 m
    const rs=[pts[0]];let acc=0;for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);acc+=d;if(acc>=5){rs.push(pts[i]);acc=0;}}if(rs.length<2||rs[rs.length-1]!==pts[pts.length-1])rs.push(pts[pts.length-1]);
    const n=rs.length,hd=[];for(let i=0;i<n;i++){const a=rs[Math.max(0,i-1)],b=rs[Math.min(n-1,i+1)];hd.push(Math.atan2(b[1]-a[1],b[0]-a[0]));}
    const B=4,kap=[];for(let i=0;i<n;i++){const a=Math.max(0,i-B),b=Math.min(n-1,i+B);let d=hd[b]-hd[a];while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;kap.push((b>a)?d/((b-a)*5):0);}
    // rótulo por ponto: J (junção), C (curva), R (reta)
    const kIn=1/opt.raioCurva,kOut=0.7/opt.raioCurva;let curva=false;
    const lab=rs.map((p,i)=>{if(perto(p[0],p[1])>=0)return'J';const k=Math.abs(kap[i]);if(curva?k>kOut:k>kIn)curva=true;else curva=false;return curva?'C':'R';});
    // runs
    let runs=[];for(let i=0;i<n;i++){if(runs.length&&runs[runs.length-1].t===lab[i])runs[runs.length-1].j=i;else runs.push({t:lab[i],i,j:i});}
    const len=r=>(r.j-r.i+1)*5;
    // funde trechos curtos: curva curta vira reta, reta curta entre curvas vira curva
    for(let pass=0;pass<3;pass++){for(let q=0;q<runs.length;q++){const r=runs[q];if(r.t==='C'&&len(r)<opt.minCurva)r.t='R';if(r.t==='R'&&len(r)<opt.minReta&&q>0&&q<runs.length-1&&runs[q-1].t==='C'&&runs[q+1].t==='C')r.t='C';}
      const m=[];for(const r of runs){if(m.length&&m[m.length-1].t===r.t)m[m.length-1].j=r.j;else m.push(Object.assign({},r));}runs=m;}
    // reta curta solta: junta com o vizinho mais longo
    for(let q=0;q<runs.length;q++){const r=runs[q];if(r.t!=='J'&&len(r)<20&&runs.length>1){const nb2=[runs[q-1],runs[q+1]].filter(Boolean).filter(x=>x.t!=='J').sort((a,b)=>len(b)-len(a))[0];if(nb2)r.t=nb2.t;}}
    {const m=[];for(const r of runs){if(m.length&&m[m.length-1].t===r.t)m[m.length-1].j=r.j;else m.push(Object.assign({},r));}runs=m;}
    for(const r of runs){if(r.t==='J')continue;const poly=rs.slice(Math.max(0,r.i-1),Math.min(n,r.j+2));let kmax=0;for(let i=r.i;i<=r.j;i++)kmax=Math.max(kmax,Math.abs(kap[i]));
      let L=0;for(let i=1;i<poly.length;i++)L+=Math.hypot(poly[i][0]-poly[i-1][0],poly[i][1]-poly[i-1][1]);
      secs.push({tipo:r.t==='C'?'Curva':'Reta',poly,len:L,raio:r.t==='C'&&kmax>0?1/kmax:null});}}
  for(const j of juncs)secs.push({tipo:'Interseção',x:j.x,y:j.y,r:opt.rInter,len:2*opt.rInter,poly:null});
  for(const z of zonas)secs.push({tipo:z.tipo,x:z.x,y:z.y,r:z.r,len:null,poly:null});
  // 6) rótulo de cada ponto GPS: zona > interseção > trecho mais próximo (até dMax)
  const lbl=new Int32Array(NX*NY).fill(-1),dist=new Float32Array(NX*NY).fill(1e9);
  const q=[];secs.forEach((s,si)=>{if(!s.poly)return;for(let i=1;i<s.poly.length;i++){const[a,b]=[s.poly[i-1],s.poly[i]];const L=Math.hypot(b[0]-a[0],b[1]-a[1]),m=Math.max(1,Math.ceil(L/(G/2)));for(let t=0;t<=m;t++){const x=a[0]+(b[0]-a[0])*t/m,y=a[1]+(b[1]-a[1])*t/m;const k=id(gx(x),gy(y));if(dist[k]>0){dist[k]=0;lbl[k]=si;q.push(k);}}}});
  for(let h=0;h<q.length;h++){const k=q[h],a=(k/NY)|0,b=k%NY;for(const[da,db]of N8){const aa=a+da,bb=b+db;if(aa<0||bb<0||aa>=NX||bb>=NY)continue;const kk=id(aa,bb),nd=dist[k]+G*Math.hypot(da,db);if(nd<dist[kk]&&nd<=opt.dMax){dist[kk]=nd;lbl[kk]=lbl[k];q.push(kk);}}}
  const nS=secs.length,jBase=secs.findIndex(s=>s.tipo==='Interseção');
  const atrib=(x,y)=>{const z=naZona(x,y);if(z>=0)return nS-zonas.length+z;
    if(jBase>=0){let bj=-1,bd=1e9;for(let j=0;j<juncs.length;j++){const d=Math.hypot(juncs[j].x-x,juncs[j].y-y);if(d<opt.rInter&&d<bd){bd=d;bj=j;}}if(bj>=0)return jBase+bj;}
    const a=gx(x),b=gy(y);return(a>=0&&b>=0&&a<NX&&b<NY)?lbl[id(a,b)]:-1;};
  const sid=new Array(N);for(let i=0;i<N;i++)sid[i]=atrib(P.x[i],P.y[i]);
  const eid=[];if(E)for(let j=0;j<E.x.length;j++)eid.push(atrib(E.x[j],E.y[j]));
  const out=secs.map((s,k)=>{const o={id:k+1,tipo:s.tipo,len:s.len!=null?Math.round(s.len):null};
    if(s.poly){o.poly=s.poly.map(p=>[Math.round(p[0]),Math.round(p[1])]);let sx=0,sy=0;for(const p of s.poly){sx+=p[0];sy+=p[1];}o.x=Math.round(sx/s.poly.length);o.y=Math.round(sy/s.poly.length);}
    else{o.x=Math.round(s.x);o.y=Math.round(s.y);o.r=Math.round(s.r);}
    if(s.raio)o.raio=Math.round(s.raio);return o;});
  return {secoes:out,sid,eid};
}
if(typeof module!=='undefined')module.exports={rodarPipeline,secoesFisicas};
