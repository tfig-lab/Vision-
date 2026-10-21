import pandas as pd, numpy as np
from classif import NAO_PERDA, PRIORIDADE
PRE, POS = 5, 20   # s antes do início / após o fim do evento em que a velocidade ainda é influenciada

def associar(v, e):
    e=e.copy()
    # término ausente (1969) -> duração mediana da mesma razão
    medr=e[e.fim_valido].groupby('Razao').dur_s.median()
    e['dur_use']=np.where(e.fim_valido,e.dur_s,e.Razao.map(medr).fillna(0)).clip(0,1200)
    e['a']=e.ini-pd.to_timedelta(PRE,'s'); e['b']=e.ini+pd.to_timedelta(e.dur_use+POS,'s')
    cats=[c for c in PRIORIDADE if c in set(e.cat)]
    v=v.copy()
    for c in cats: v['f_'+c]=False
    v['cat_pri']='Sem evento'; v['razao_pri']=''; v['ev_id']=-1
    rank={c:k for k,c in enumerate(cats)}
    ee=e[e.cat.isin(cats)].copy(); ee['rk']=ee.cat.map(rank)
    for tag,vi in v.groupby('TAG').groups.items():
        t=v.loc[vi,'t'].values.astype('datetime64[ns]').astype(np.int64)
        sub=ee[ee.TAG==tag]
        if sub.empty: continue
        a=sub.a.values.astype('datetime64[ns]').astype(np.int64); b=sub.b.values.astype('datetime64[ns]').astype(np.int64)
        M=(t[:,None]>=a[None,:])&(t[:,None]<=b[None,:])   # pontos x eventos
        for c in cats:
            mc=(sub.cat.values==c)
            if mc.any(): v.loc[vi,'f_'+c]=M[:,mc].any(1)
        # evento principal: maior prioridade, depois o mais recente
        rk=np.where(M,sub.rk.values[None,:],999)
        best_rk=rk.min(1)
        cand=np.where(rk==best_rk[:,None],a[None,:],-np.inf)
        j=cand.argmax(1); has=best_rk<999
        idx=np.array(vi)
        v.loc[idx[has],'cat_pri']=sub.cat.values[j[has]]
        v.loc[idx[has],'razao_pri']=sub.Razao.values[j[has]]
        v.loc[idx[has],'ev_id']=sub.Id_Evento_Origem.values[j[has]]
    return v, e

def paradas_longas(v, lim=600):
    """episódios contínuos com v<1 km/h por mais de `lim` s (fora de ciclo: manutenção, abastecimento, troca de turno...)"""
    v=v.copy()
    stop=v.v<1
    brk=(stop!=stop.groupby(v.TAG).shift(1))|(v.TAG!=v.TAG.shift(1))
    ep=brk.cumsum()
    dur=v.groupby(ep).w.transform('sum')
    v['parada_longa']=stop&(dur>=lim)
    v['ep_dur']=np.where(stop,dur,0)
    return v
