import re
# ordem importa: primeira regra que casar
REGRAS = [
 ('Status (não causal)', r'^AT is moving|^AT mode changed|^AT Exception$|stopped and locked|currently traveling in Delay|Leave AT Notification|Auto Travel activated|Come in not pressed|Other modules are preventing|Equipment is not assigned|^AT is moving'),
 ('Operação de carga/basculamento', r'in Loading|in Dumping|while Spotting|during Loading|during Fueling|stopped by an operator during load|High dump operation|Edge [Dd]ump|Hoist limit'),
 ('Fila/espera (carga, despacho)', r'Delay by Loader|Loader is Busy|Load Wait Point|Location hold|waits to go to the dump|Cannot proceed to load|Loader is not locked'),
 ('Interferência equip. auxiliar/manual', r'(Passing Area|Passing Mode|Travel Mode|Escort Mode|Manual Permission) [Ss]top'),
 ('Tráfego entre autônomos', r'Stopped by Auto Interaction|Blocked by AHT|Blocked by Stopped AT|Collision Risk|Deadlock|Resource blocked|Resource closed|Auto Permission|relinquish permission|Proximity Warning|execute the permission'),
 ('Limitação de velocidade', r'Narrow road speed|Sobrecarga|overspeed at switchback|Reduce speed|Slip control|[Ss]lippage'),
 ('Restrição de via/rota', r'Road is closed|Intersection is closed|No path|Path does not exist|No route|Node needs path|Node count is low|No node available|No Active Tiparea|Location closed|[Cc]ourse out|Out of course|[Rr]ecovery|dismiss course|main path blocked|blocked by survey|unsafe route|Time over|trajectory|course is null|Illegal trajectory|Need Recovery'),
 ('Detecção de obstáculo', r'Detected by|SRR\(|detected$'),
 ('Falha de sensor (laser/radar)', r'Laser|LBI|ODS|Radar'),
 ('GNSS/navegação', r'GNSS|[Pp]osition|satellites|[Ff]usion|External Sensor|Heading angle|GYRO|[Nn]avigation|Yaw angle|Roll angle|ROLL angle|Observer controller|Quality|Accurate'),
 ('Comunicação/sistema', r'[Cc]ommunication|heartbeat|Heartbeat|Synchronizing|Maintenance Version|Field computer|SystemClock|recorder|disk space|Interface Module|Reset running|Illegal argument|CDS|timestamp|memory card|VehicleControl|other equipment'),
 ('Mecânica/equipamento', r'engine|Engine|Lube|Fuel|Hydraulic|Voltage|power|Brake|Steering|Propel|Ladder|Battery|Payload|PLM|relay|Shift position|Emergency stop|Power'),
]
ORDEM=[r[0] for r in REGRAS]+['Outros']
def classificar(tipo, razao):
    if razao is None or razao!=razao or str(razao).strip()=='' :
        return 'Status (não causal)'   # registros de estado sem razão (LH_MODE, NAV_STATUS, TRUCK_STOP vazio)
    for nome,pat in REGRAS:
        if re.search(pat,str(razao)): return nome
    return 'Outros'

NAO_PERDA={'Status (não causal)','Operação de carga/basculamento'}
PRIORIDADE=['Operação de carga/basculamento','Interferência equip. auxiliar/manual','Tráfego entre autônomos','Fila/espera (carga, despacho)',
 'Restrição de via/rota','Detecção de obstáculo','Limitação de velocidade','Falha de sensor (laser/radar)','GNSS/navegação','Comunicação/sistema','Mecânica/equipamento','Outros']
