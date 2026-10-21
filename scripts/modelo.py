import pandas as pd, numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold
from classif import NAO_PERDA
FEAT=['X','Y','hs','hc','grade','cheio','curv','z']

def feats(v):
    v=v.copy()
    v['hs']=np.sin(np.radians(v.hd)); v['hc']=np.cos(np.radians(v.hd))
    v['cheio']=(v.carga=='Cheio').astype(float)
    return v

def referencia(v):
    """Velocidade de referência = velocidade típica (mediana) em fluxo livre no mesmo local, sentido, rampa, carga e curvatura,
    aprendida apenas com pontos SEM nenhum evento ativo e em movimento. Previsão out-of-fold por caminhão (GroupKFold)."""
    v=feats(v)
    limpo=(v.cat_pri=='Sem evento')&(v.v>=2)&~v.parada_longa
    v['vref']=np.nan; scores=[]
    gkf=GroupKFold(n_splits=5)
    for tr,te in gkf.split(v,groups=v.TAG):
        trm=np.zeros(len(v),bool); trm[tr]=True; trm&=limpo.values
        m=HistGradientBoostingRegressor(loss='absolute_error',max_iter=400,learning_rate=0.08,max_leaf_nodes=63,min_samples_leaf=30,random_state=0)
        m.fit(v.loc[trm,FEAT],v.loc[trm,'v'])
        v.iloc[te,v.columns.get_loc('vref')]=m.predict(v.iloc[te][FEAT])
        tm=np.zeros(len(v),bool); tm[te]=True; tm&=limpo.values
        r=v.loc[tm,'v']-v.loc[tm,'vref']
        scores.append((np.abs(r).mean(), 1-((r**2).sum()/((v.loc[tm,'v']-v.loc[tm,'v'].mean())**2).sum())))
    v['vref']=v.vref.clip(lower=2)
    v['res']=v.v-v.vref
    v['frac']=((v.vref-v.v)/v.vref).clip(0,1)
    v['perda_s']=v.w*v.frac*(~v.parada_longa)
    # modelo final (todos os pontos limpos) p/ curvas de rampa
    mfin=HistGradientBoostingRegressor(loss='absolute_error',max_iter=400,learning_rate=0.08,max_leaf_nodes=63,min_samples_leaf=30,random_state=0).fit(v.loc[limpo,FEAT],v.loc[limpo,'v'])
    return v, scores, mfin, limpo
