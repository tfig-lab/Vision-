import pandas as pd, numpy as np
from pyproj import Transformer
from classif import classificar, ORDEM

def carregar(inter_csv, vel_csv):
    rd=lambda f: pd.read_csv(f,sep=';',decimal=',',encoding='utf-8-sig',low_memory=False)
    i, v = rd(inter_csv), rd(vel_csv)
    # ---------- eventos: dedup (base vem multiplicada por join de equipamento/tipo) ----------
    e=i.drop_duplicates(['Id_Evento_Origem','TAG']).copy()
    for c in ['Data_Inicio','Data_Termino']: e[c]=pd.to_datetime(e[c])
    e['fim_valido']=(e.Data_Termino.dt.year>2000)&(e.Data_Termino>=e.Data_Inicio)
    e['dur_s']=np.where(e.fim_valido,(e.Data_Termino-e.Data_Inicio).dt.total_seconds(),0.0)
    tr=Transformer.from_crs(4326,31982,always_xy=True)   # SIRGAS2000 / UTM 22S (mesmo sistema da base de velocidade)
    e['X'],e['Y']=tr.transform(e.Longitude.values,e.Latitude.values)
    e['Razao']=e.Razao.fillna('(sem razão – registro de estado)')
    e['cat']=[classificar(a,b if not b.startswith('(sem') else None) for a,b in zip(e.Tipo_Alerta,e.Razao)]
    e=e.rename(columns={'Data_Inicio':'ini'})[['Id_Evento_Origem','TAG','Turno','ini','Data_Termino','fim_valido','dur_s','X','Y','Longitude','Latitude','Tipo_Alerta','Razao','cat','Origem']]
    # ---------- velocidade ----------
    v['t']=pd.to_datetime(v.Data_Leitura)
    v['Turno']=v.NomeTurno.str.split().str[-1]
    v=v[['TAG','Turno','t','PosX','PosY','PosZ','Velocidade','Direcao']].rename(columns={'PosX':'X','PosY':'Y','Velocidade':'v','Direcao':'hd'})
    v['z']=v.PosZ/10.0       # cota em decímetros -> metros
    v=v.drop(columns='PosZ').sort_values(['TAG','t']).reset_index(drop=True)
    g=v.groupby('TAG')
    v['dt_next']=(g.t.shift(-1)-v.t).dt.total_seconds()
    v['dt_prev']=(v.t-g.t.shift(1)).dt.total_seconds()
    v['w']=v.dt_next.clip(upper=30).fillna(10)          # tempo representado pelo ponto (s), lacunas truncadas
    v['ds']=np.hypot(v.X-g.X.shift(1),v.Y-g.Y.shift(1))
    v['salto']=(v.ds/v.dt_prev*3.6>80)&(v.dt_prev>0)  # salto de GPS
    # rampa no sentido do deslocamento: janela de pontos vizinhos com >=20 m de percurso
    v['s']=v.groupby('TAG').ds.transform(lambda s: s.fillna(0).cumsum())
    # rampa (%) no sentido do deslocamento: diferença centrada entre pontos vizinhos (amostragem ~10 s)
    zp,zn=g.z.shift(1),g.z.shift(-1); sp,sn=g.s.shift(1),g.s.shift(-1)
    span=sn-sp
    v['grade']=np.where((span>=20)&(span<=400),(zn-zp)/span*100,np.nan)
    one=v.ds
    v['grade']=v.grade.where(v.grade.notna(),np.where((one>=15)&(one<=300),(v.z-zp)/one*100,np.nan))
    v.loc[v.grade.abs()>20,'grade']=np.nan
    # pontos parados/sem vizinho: herda a rampa típica da célula de 20 m no mesmo rumo (8 setores)
    v['cell']=(v.X//20).astype(int).astype(str)+'_'+(v.Y//20).astype(int).astype(str)
    v['sec']=((v.hd+22.5)%360//45).astype(int)
    med=v.groupby(['cell','sec']).grade.median()
    v['grade_src']=np.where(v.grade.notna(),'medida','celula')
    fill=pd.Series(list(zip(v.cell,v.sec))).map(med).values
    v['grade']=v.grade.fillna(pd.Series(fill,index=v.index))
    opp=pd.Series(list(zip(v.cell,(v.sec+4)%8))).map(med).values
    v['grade']=v.grade.fillna(pd.Series(-opp,index=v.index))
    medc=v.groupby('cell').grade.apply(lambda x: x.abs().median())
    v.loc[v.grade.isna(),'grade_src']='indef'
    # curvatura: variação de rumo por 100 m
    dh=(g.hd.shift(-1)-g.hd.shift(1)+180)%360-180
    dd=v.ds.fillna(0)+g.ds.shift(-1).fillna(0)
    v['curv']=np.where(dd>8,np.abs(dh)/dd*100,np.nan)
    v['curv']=v.curv.clip(upper=120)
    return e, v

def estado_carga(v, e):
    """Cheio/Vazio a partir da sequência de eventos de Carga e Basculamento de cada caminhão."""
    ev=e[e.Razao.isin(['AT is in Loading','AT is in Dumping'])][['TAG','ini','Data_Termino','fim_valido','Razao']].copy()
    ev['fim']=np.where(ev.fim_valido,ev.Data_Termino,ev.ini)
    ev['estado_apos']=np.where(ev.Razao=='AT is in Loading','Cheio','Vazio')
    ev['estado_antes']=np.where(ev.Razao=='AT is in Loading','Vazio','Cheio')
    v=v.sort_values('t')
    a=ev.sort_values('fim')[['TAG','fim','estado_apos']]
    b=ev.sort_values('ini')[['TAG','ini','estado_antes']]
    m=pd.merge_asof(v,a,left_on='t',right_on='fim',by='TAG',direction='backward')
    m=pd.merge_asof(m.sort_values('t'),b,left_on='t',right_on='ini',by='TAG',direction='forward')
    m['carga']=m.estado_apos.fillna(m.estado_antes).fillna('Indefinido')
    m=m.drop(columns=['fim','estado_apos','ini','estado_antes'])
    return m.sort_values(['TAG','t']).reset_index(drop=True)
