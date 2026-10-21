"""Reduções de velocidade x interações — a interação é o valor da coluna Razao (como na base); linhas sem Razao não são interação.
Uso: python pipeline5.py Interacoes.csv velocidade_trecho.csv saida/ [de-para.xlsx]
"""
import sys, os, json, pandas as pd, numpy as np, statsmodels.api as sm
from prep import carregar, estado_carga
from assoc import paradas_longas
from modelo import referencia

PRE, POS = 5, 20     # s: janela de influência do evento (antes do início / após o fim)
TOL = 3.0            # km/h: queda menor que o erro típico da referência não conta como perda
inter, vel, out = sys.argv[1], sys.argv[2], sys.argv[3]; os.makedirs(out, exist_ok=True)
depara = sys.argv[4] if len(sys.argv)>4 else None
SEM_GRUPO='Sem grupo na planilha'
raw_inter=sum(1 for _ in open(inter,encoding='utf-8-sig'))-1
e,v=carregar(inter,vel)
e['Razao']=e.Razao.replace('(sem razão – registro de estado)','(Razao vazia)')
v=estado_carga(v,e)
T0=v.t.min().floor('h')

# ---------- interação = valor da coluna Razao, exatamente como na base ----------
e_all=e.copy()
e=e[e.Razao!='(Razao vazia)'].copy()
# grupo: Evento_Codigo da base = 'Event Code' da planilha de-para; grupo = coluna L 'Consolidação Operação'
cod=pd.read_csv(inter,sep=';',encoding='utf-8-sig',usecols=['Id_Evento_Origem','TAG','Evento_Codigo'],dtype={'Evento_Codigo':str}).drop_duplicates(['Id_Evento_Origem','TAG'])
e=e.merge(cod,on=['Id_Evento_Origem','TAG'],how='left'); e['Evento_Codigo']=e.Evento_Codigo.str.strip().str.upper()
if depara:
    dp=pd.read_excel(depara,header=1); dp.columns=[str(c).strip() for c in dp.columns]
    dp['code']=dp['Event Code'].astype(str).str.strip().str.upper()
    gmap=dp.dropna(subset=['Consolidação Operação']).drop_duplicates('code').set_index('code')['Consolidação Operação'].str.strip()
    e['grupo']=e.Evento_Codigo.map(gmap).fillna(SEM_GRUPO)
else: e['grupo']=SEM_GRUPO
e['par']=e.grupo+' | '+e.Razao
# só entram no modelo as interações com grupo na planilha de-para.
# AT is in Loading / AT is in Dumping continuam sendo usados apenas para cheio/vazio, ciclos e referência = 0.
e_ref=e.copy()
medr0=e_ref[e_ref.fim_valido].groupby('Razao').dur_s.median()
e_ref['dur_use']=np.where(e_ref.fim_valido,e_ref.dur_s,e_ref.Razao.map(medr0).fillna(0)).clip(0,1200)
e_sg=e[e.grupo==SEM_GRUPO].copy()
e=e[e.grupo!=SEM_GRUPO].copy()
print('interações com grupo (no modelo):',len(e),'| sem grupo (fora do modelo):',len(e_sg))
pares=e.groupby('par').size().sort_values(ascending=False).index.tolist(); pi={p:k for k,p in enumerate(pares)}
e['pi']=e.par.map(pi)
medr=e[e.fim_valido].groupby('par').dur_s.median()
e['dur_use']=np.where(e.fim_valido,e.dur_s,e.par.map(medr).fillna(0)).clip(0,1200)
e['a']=e.ini-pd.to_timedelta(PRE,'s'); e['b']=e.ini+pd.to_timedelta(e.dur_use+POS,'s')

# ---------- associação: todos os pares ativos em cada leitura ----------
ativos=[[] for _ in range(len(v))]
for tag,vi in v.groupby('TAG').groups.items():
    t=v.loc[vi,'t'].values.astype('datetime64[ns]').astype(np.int64)
    sub=e[e.TAG==tag]
    if sub.empty: continue
    a=sub.a.values.astype('datetime64[ns]').astype(np.int64); b=sub.b.values.astype('datetime64[ns]').astype(np.int64)
    M=(t[:,None]>=a[None,:])&(t[:,None]<=b[None,:])
    pv=sub.pi.values; idx=np.asarray(vi)
    for r,c in zip(*np.nonzero(M)): ativos[idx[r]].append(pv[c])
v['ativos']=[sorted(set(x)) for x in ativos]
v['n_at']=v.ativos.str.len()
v=paradas_longas(v)
v['cat_pri']=np.where(v.n_at==0,'Sem evento','Com evento')   # referência treinada só em leituras sem nenhum evento
v,scores,mfin,limpo=referencia(v)
# durante AT is in Loading / AT is in Dumping (do início ao término do evento) a referência é 0: parado é o esperado
ciclo_ev=e_ref[e_ref.Razao.isin(['AT is in Loading','AT is in Dumping'])]
v['em_carga_bascul']=False
for tag,vi in v.groupby('TAG').groups.items():
    sub=ciclo_ev[ciclo_ev.TAG==tag]
    if sub.empty: continue
    t=v.loc[vi,'t'].values.astype('datetime64[ns]').astype(np.int64)
    a0=sub.ini.values.astype('datetime64[ns]').astype(np.int64); b0=(sub.ini+pd.to_timedelta(sub.dur_use,'s')).values.astype('datetime64[ns]').astype(np.int64)
    m=((t[:,None]>=a0[None,:])&(t[:,None]<=b0[None,:])).any(1)
    v.loc[np.asarray(vi)[m],'em_carga_bascul']=True
v.loc[v.em_carga_bascul,'vref']=0.0
print('leituras com referência zerada (carga/basculamento):',int(v.em_carga_bascul.sum()))
d=v.vref-v.v
v['frac']=np.where(d>TOL,(d/v.vref).clip(0,1),0.0)
v['perda_s']=v.w*v.frac*(~v.parada_longa)
v['deficit']=np.where(d>TOL,d,0.0)          # km/h abaixo da referência

# ---------- perda por interação (divisão igual entre as interações ativas na leitura) ----------
rows=[]
for i,(lst,p,w,dd,tag,vv,vr) in enumerate(zip(v.ativos,v.perda_s,v.w,d,v.TAG,v.v,v.vref)):
    if v.parada_longa.iat[i] or not lst: continue
    for k in lst: rows.append((k,p/len(lst),w,dd,tag))
A=pd.DataFrame(rows,columns=['pi','perda','w','queda','TAG'])
tipos=['TRUCK_STOP','EXCEPTION','WARNING','LH_MODE','TRUCK_MOVING','NAV_STATUS','OP_MODE']
tipos=[t for t in tipos if t in set(e.Tipo_Alerta)]+sorted(set(e.Tipo_Alerta)-set(tipos))

# ---------- estatística: efeito fixo de local (célula 25 m × rumo) ----------
def fe_reg(cols_fn,names):
    dd=v[~v.parada_longa & v.grade.notna()].copy()
    dd['curv']=dd.curv.fillna(dd.groupby('cell').curv.transform('median')).fillna(0)
    dd['grp']=(dd.X//25).astype(int).astype(str)+'_'+(dd.Y//25).astype(int).astype(str)+'_'+dd.sec.astype(str)
    ch=(dd.carga=='Cheio').astype(float)
    F=pd.DataFrame({'Subida·cheio':dd.grade.clip(lower=0)*ch,'Subida·vazio':dd.grade.clip(lower=0)*(1-ch),'Descida·cheio':(-dd.grade).clip(lower=0)*ch,
                    'Descida·vazio':(-dd.grade).clip(lower=0)*(1-ch),'Cheio':ch,'Curvatura':dd.curv},index=dd.index)
    X=pd.concat([F,cols_fn(dd)],axis=1)
    gm=lambda s: s-s.groupby(dd.grp).transform('mean')
    Xw=X.apply(gm); yw=gm(dd.v); ok=dd.groupby('grp').v.transform('size')>1
    keep=[c for c in Xw.columns if Xw.loc[ok,c].abs().sum()>0]
    r=sm.OLS(yw[ok],Xw.loc[ok,keep]).fit(cov_type='cluster',cov_kwds={'groups':dd.TAG[ok].astype('category').cat.codes})
    ci=r.conf_int()
    tab=pd.DataFrame({'coef':r.params,'lo':ci[0],'hi':ci[1],'p':r.pvalues})
    tab['exp_h']=[np.nan if c in F.columns else dd.loc[X[c]>0,'w'].sum()/3600 for c in tab.index]
    return tab.loc[[c for c in tab.index if c in names or c in F.columns]], int(ok.sum())
def tipo_cols(dd):
    s={t:set(e.loc[e.Tipo_Alerta==t,'pi']) for t in tipos}
    return pd.DataFrame({t:[float(bool(s[t].intersection(x))) for x in dd.ativos] for t in tipos},index=dd.index)
top_pares=[p for p in pares if (e.par==p).sum()>=30]
def par_cols(dd):
    return pd.DataFrame({p:[float(pi[p] in x) for x in dd.ativos] for p in top_pares},index=dd.index)
tab_par,nreg=fe_reg(par_cols,top_pares)
grupos=e.groupby('grupo').size().sort_values(ascending=False).index.tolist()
gset={g:set(e.loc[e.grupo==g,'pi']) for g in grupos}
def grupo_cols(dd):
    return pd.DataFrame({g:[float(bool(gset[g].intersection(x))) for x in dd.ativos] for g in grupos if (e.grupo==g).sum()>=10},index=dd.index)
tab_grupo,_=fe_reg(grupo_cols,grupos)

# Shapley: pista (sem efeito de local) x interações por Tipo_Alerta
dd=v[~v.parada_longa & v.grade.notna()].copy(); dd['curv']=dd.curv.fillna(0)
ch=(dd.carga=='Cheio').astype(float)
Pm=pd.DataFrame({'a':dd.grade.clip(lower=0)*ch,'b':dd.grade.clip(lower=0)*(1-ch),'c':(-dd.grade).clip(lower=0)*ch,'d':(-dd.grade).clip(lower=0)*(1-ch),'e':ch,'f':dd.curv})
Em=par_cols(dd)
r2=lambda X: sm.OLS(dd.v,sm.add_constant(X)).fit().rsquared
rp,re_,ra=r2(Pm),r2(Em),r2(pd.concat([Pm,Em],axis=1))
r2fe=1-((dd.v-dd.v.groupby((dd.X//25).astype(int).astype(str)+'_'+(dd.Y//25).astype(int).astype(str)+'_'+dd.sec.astype(str)).transform('mean'))**2).sum()/((dd.v-dd.v.mean())**2).sum()
shap=dict(pista=(rp+ra-re_)/2,inter=(re_+ra-rp)/2,total=ra,local=r2fe)
Pn=Pm.rename(columns={'a':'Subida·cheio (por % de rampa)','b':'Subida·vazio (por % de rampa)','c':'Descida·cheio (por % de rampa)','d':'Descida·vazio (por % de rampa)','e':'Cheio (vs vazio)','f':'Curvatura (por °/100 m)'})
rr=sm.OLS(dd.v,sm.add_constant(pd.concat([Pn,Em],axis=1))).fit(cov_type='cluster',cov_kwds={'groups':dd.TAG.astype('category').cat.codes})
tab_pista=pd.DataFrame({'coef':rr.params,'lo':rr.conf_int()[0],'hi':rr.conf_int()[1],'p':rr.pvalues}).loc[Pn.columns]

# curva rampa x velocidade (sem eventos, em movimento)
cl=v[limpo.values & v.grade.notna()].copy(); cl['gb']=cl.grade.clip(-14,14).round().astype(int)
curva=cl.groupby(['carga','gb']).v.agg(['median','size']).reset_index(); curva.columns=['carga','grade','med','n']
curva=curva[(curva.n>=40)&(curva.carga!='Indefinido')]

# ---------- ciclos: início de um "AT is in Loading" até o início do próximo, mesmo caminhão ----------
ld=e_ref[e_ref.Razao=='AT is in Loading'].sort_values(['TAG','ini'])
dp=e_ref[e_ref.Razao=='AT is in Dumping']
tags=sorted(v.TAG.unique().tolist()); ti={t:k for k,t in enumerate(tags)}
ciclos=[]
for tag,g in ld[ld.TAG.isin(tags)].groupby('TAG'):
    st=g.ini.tolist()
    for n,(a,b) in enumerate(zip(st[:-1],st[1:])):
        if (b-a).total_seconds()<120: continue
        dps=dp[(dp.TAG==tag)&(dp.ini>a)&(dp.ini<b)].ini
        if ((v.TAG==tag)&(v.t>=a)&(v.t<b)).sum()<5: continue   # sem leituras de GPS no intervalo
        ciclos.append([ti[tag],int((a-T0).total_seconds()),int((b-T0).total_seconds()),int((dps.min()-T0).total_seconds()) if len(dps) else -1])

# ---------- export ----------
x0,y0=float(v.X.min()),float(v.Y.min())
eo=[0]; el=[]
for lst in v.ativos: el.extend(int(x) for x in lst); eo.append(len(el))
P=dict(t=((v.t-T0).dt.total_seconds()).round().astype(int).tolist(),x=(v.X-x0).round().astype(int).tolist(),y=(v.Y-y0).round().astype(int).tolist(),
  v=(v.v*10).round().astype(int).tolist(),r=(v.vref*10).round().astype(int).tolist(),w=v.w.round().astype(int).tolist(),k=v.TAG.map(ti).tolist(),
  c=v.carga.map({'Cheio':0,'Vazio':1}).fillna(2).astype(int).tolist(),s=v.Turno.map({'Diurno':0,'Noturno':1}).tolist(),
  p=(v.perda_s*10).round().astype(int).tolist(),sc=v.sec.astype(int).tolist(),g=v.grade.fillna(-99.9).mul(10).round().astype(int).tolist(),
  lp=v.parada_longa.astype(int).tolist(),eo=eo,el=el)
ee=e[e.TAG.isin(tags)]
ee=pd.merge_asof(ee.sort_values('ini'),v[['t','TAG','carga']].sort_values('t'),left_on='ini',right_on='t',by='TAG',direction='nearest',tolerance=pd.Timedelta('60s'))
E=dict(tp=ee.Tipo_Alerta.map({t:k for k,t in enumerate(tipos)}).tolist(),k=ee.TAG.map(ti).tolist(),t=((ee.ini-T0).dt.total_seconds()).round(1).tolist(),d=ee.dur_use.round(1).tolist(),f=ee.fim_valido.astype(int).tolist(),
  q=ee.pi.tolist(),x=(ee.X-x0).round().astype(int).tolist(),y=(ee.Y-y0).round().astype(int).tolist(),
  s=ee.Turno.map({'Diurno':0,'Noturno':1}).tolist(),c=ee.carga.map({'Cheio':0,'Vazio':1}).fillna(2).astype(int).tolist())
tj=lambda t:[dict(nome=i,**{k:(None if pd.isna(x) else float(x)) for k,x in r.items()}) for i,r in t.iterrows()]
meta=dict(origem=[x0,y0],t0=str(T0),tags=[str(t) for t in tags],tipos=tipos,
  pares=[dict(razao=p.split(' | ',1)[1],grupo=p.split(' | ',1)[0],tipos=sorted(set(e.loc[e.par==p,'Tipo_Alerta'])),n=int((e.par==p).sum())) for p in pares],grupos=[dict(nome=g,n=int((e.grupo==g).sum())) for g in grupos],sem_grupo=SEM_GRUPO,reg_grupo=tj(tab_grupo),eventos_sem_razao=int((e_all.Razao=='(Razao vazia)').sum()),
  loadxy=[[round(a-x0),round(b-y0)] for a,b in e_ref.loc[e_ref.Razao=='AT is in Loading',['X','Y']].values],dumpxy=[[round(a-x0),round(b-y0)] for a,b in e_ref.loc[e_ref.Razao=='AT is in Dumping',['X','Y']].values],eventos_fora=int(len(e_sg)),
  periodo=[str(v.t.min())[:16],str(v.t.max())[:16]],tol=TOL,pre=PRE,pos=POS,cv=[dict(mae=float(a),r2=float(b)) for a,b in scores],
  q=dict(linhas=raw_inter,eventos=int(len(e)),sem_fim=int((~e.fim_valido).sum()),pontos=int(len(v)),horas=float(v.w.sum()/3600),
         pts_limpos=int(limpo.sum()),pts_com_evento=int((v.n_at>0).sum()),n_reg=nreg,pares=len(pares)),
  reg_pista=tj(tab_pista),reg_par=tj(tab_par),shap={k:float(x) for k,x in shap.items()},curva=curva.round(3).to_dict('records'),ciclos=ciclos)
json.dump(dict(meta=meta,P=P,E=E),open(os.path.join(out,'dados.json'),'w'),separators=(',',':'),ensure_ascii=False)
# planilha
A['grupo']=A.pi.map(lambda k:pares[k].split(' | ',1)[0]); A['razao']=A.pi.map(lambda k:pares[k].split(' | ',1)[1])
cnt=e.groupby(['grupo','Razao']).agg(eventos=('pi','size'),caminhoes=('TAG','nunique'),Tipo_Alerta=('Tipo_Alerta',lambda x:', '.join(sorted(set(x)))))
rz=A.groupby(['grupo','razao']).agg(perda_h=('perda','sum'),leituras=('w','size'),queda_media_kmh=('queda','mean')).assign(perda_h=lambda x:x.perda_h/3600)
rz=rz.join(cnt.rename_axis(['grupo','razao'])).sort_values('perda_h',ascending=False); rz['perda_por_evento_s']=rz.perda_h*3600/rz.eventos
with pd.ExcelWriter(os.path.join(out,'resultados_velocidade.xlsx')) as xw:
    rz.reset_index().to_excel(xw,sheet_name='Perda por Razao',index=False)
    e_sg.groupby(['Evento_Codigo','Tipo_Alerta','Razao']).size().rename('eventos').reset_index().sort_values('eventos',ascending=False).to_excel(xw,sheet_name='Fora do modelo (sem grupo)',index=False)
    tab_pista.to_excel(xw,sheet_name='Efeito da pista'); tab_grupo.to_excel(xw,sheet_name='Regressao Grupo')
    A.groupby('grupo').agg(perda_h=('perda','sum')).div(3600).join(e.groupby('grupo').size().rename('eventos')).sort_values('perda_h',ascending=False).to_excel(xw,sheet_name='Perda por Grupo'); tab_par.to_excel(xw,sheet_name='Regressao Razao')
    cy=pd.DataFrame(ciclos,columns=['tag','ini_s','fim_s','dump_s']); cy['TAG']=cy.tag.map(lambda k:tags[k])
    cy['inicio']=T0+pd.to_timedelta(cy.ini_s,'s'); cy['fim']=T0+pd.to_timedelta(cy.fim_s,'s'); cy['ciclo']=cy.groupby('TAG').cumcount()+1
    cy[['TAG','ciclo','inicio','fim']].to_excel(xw,sheet_name='Ciclos',index=False)
    e[['Id_Evento_Origem','TAG','Turno','ini','Data_Termino','fim_valido','dur_use','Tipo_Alerta','Evento_Codigo','Razao','grupo','Latitude','Longitude']].to_excel(xw,sheet_name='Eventos com Razao',index=False)
print('pontos',len(v),'limpos',int(limpo.sum()),'com evento',int((v.n_at>0).sum()),'cv',np.round(scores,3).tolist())
print('perda total h',v.perda_s.sum()/3600,'atribuida',A.perda.sum()/3600,'sem evento',v.loc[(v.n_at==0)&~v.parada_longa,'perda_s'].sum()/3600)
print(A.groupby('grupo').perda.sum().div(3600).sort_values(ascending=False).round(2).to_dict()); print(tab_grupo.round(2)); print(rz.head(8).round(2)); print(tab_par.sort_values('coef').head(12).round(2)); print(shap); print('ciclos',len(ciclos), pd.Series([c[0] for c in ciclos]).value_counts().describe().to_dict())
print(os.path.getsize(os.path.join(out,'dados.json'))/1e6,'MB')
