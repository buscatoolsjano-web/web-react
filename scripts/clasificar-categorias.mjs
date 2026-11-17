/**
 * Propone la categoría (y el tipo) correctos de cada producto. SÓLO LEE:
 * escribe revision/categorias/propuesta-<empresa>.json y un resumen.
 *
 *   node scripts/clasificar-categorias.mjs Buscatools
 *
 * Reglas en orden: la primera que acierta decide. Primero las de marca
 * (SPEEDRILL, TECNA, FEIN, FIAM, TOHNICHI: las prioritarias, revisadas una por
 * una), después las genéricas por palabra. Un producto que ya está en una
 * categoría razonable y no acierta ninguna regla, no se toca.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const empresa = process.argv[2] ?? 'Buscatools'
const P = JSON.parse(readFileSync(`revision/categorias/productos-${empresa}.json`, 'utf8'))

const N = (p) => ` ${p.nombre} ${p.desc ?? ''} `.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const NOM = (p) => ` ${p.nombre} `.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// ── Qué es repuesto ──────────────────────────────────────────────────────────
const ES_REPUESTO =
  /(^|[ .])REP([ .]|UESTO)|REPUESTO|REPLACEMENT|\bPOS\.? ?(RIF\.?)? ?\d|\bPOS \d|SPARE|KIT DE REPARACION|REPAIR KIT|DESPIECE/

// Tipos de punta/tubo por nombre (para SPEEDRILL y puntas sin tipo).
const TIPO_PUNTA = [
  [/TORX PLUS|\bTP\d/, 'Torx Plus'],
  [/\bIP\d|TORX PLUS \(IP\)/, 'Torx Plus (IP)'],
  [/TORX|\bTX ?\d|\bT\d{1,2}\b/, 'Torx'],
  [/POZIDRI|\bPZD?\d/, 'Pozidrive'],
  [/PHILLIPS|\bPH\d/, 'Phillips'],
  [/TORQ-?SET/, 'Torq-Set'],
  [/TRI-?WING/, 'Tri-Wing'],
  [/BI-?HEXAGONAL|DOBLE HEXAGONO/, 'Bi-hexagonal'],
  [/CARDANIC/, 'Cardánico'],
  [/NUTSETTER/, 'Nutsetter'],
  [/EMBOCADURA|SOCKET|TUBO /, 'Embocadura'],
  [/EXTENSI/, 'Extensión'],
  [/ADAPTADOR/, 'Adaptador'],
  [/HOLDER|PORTAPUNTA|PORTA PUNTA/, 'Holder Bit'],
  [/ALLEN|ALLEM|HEXAGONAL MEDIDA|\bEM\d/, 'Allen'],
  [/PLANA|\bPL\d|SLOTTED/, 'Plana'],
  [/CUADRAD|\bSQ\d/, 'Cuadrado'],
]
const tipoDePunta = (n) => TIPO_PUNTA.find(([r]) => r.test(n))?.[1] ?? null

/** Cada regla: [prueba, categoría, tipo | null, razón]. */
const R = (test, cat, tipo, razon) => ({ test, cat, tipo, razon })

const MARCA = {
  SPEEDRILL: [
    R((p, n) => /PROGRAMADOR/.test(n), 'accesorio', 'Programador', 'programador de herramienta'),
    R((p, n) => /LLAVE DE IMPACTO/.test(n), 'llave-de-impacto', 'Llave de impacto a batería', 'llave de impacto'),
    R((p, n) => /CARGADOR/.test(n), 'accesorio', 'Cargador', 'cargador'),
    R((p, n) => /BATERIA/.test(n), 'accesorio', 'Batería', 'batería'),
    R((p, n) => /\b20\d\d\/\d+VP|\b20\d\dVPM?\/\d+/.test(n) && !/EMBOCADURA|CARDANIC/.test(n) && !p.tipo, 'punta', 'Nutsetter', 'nutsetter 1/4 hex'),
    R((p, n) => /ANGULAR 90|SPWRT/.test(n), 'atornillador', 'Atornillador Angular', 'atornillador angular a batería'),
    R((p, n) => /TORQUIMETRO|TORQUE WRENCH/.test(n), 'llave-dinamometrica', 'Llave dinamométrica', 'torquímetro'),
    R((p, n) => /DESTORNILLADOR MANUAL/.test(n), 'herramientas-manuales', 'Destornillador', 'destornillador de mano'),
    R((p, n) => /BURLETEADORA|ROLL FORMING/.test(n), 'otros', null, 'máquina especial'),
    R((p, n) => /HOLDER MAGNETICO/.test(n), 'punta', 'Holder Bit', 'portapuntas'),
    // Todo lo demás de SPEEDRILL son puntas, embocaduras, extensiones y adaptadores.
    R(() => true, 'punta', null, 'punta / tubo SPEEDRILL'),
  ],
  TECNA: [
    R((p, n) => /CARRO|TROLLEY|ANTIGI|ROTACION Y AISLAMIENTO|70477/.test(n), 'balanceador', 'Accesorio de balanceador', 'accesorio de balanceador'),
    R(() => true, 'balanceador', 'Balanceador', 'balanceador TECNA'),
  ],
  FEIN: [
    R((p, n) => /FEIN\.?REP|\bPOS\b|BOLILLAS EMBRAGUE/.test(n), 'repuestos', 'Repuesto', 'repuesto'),
    R((p, n) => /CCG 18|AMOLADORA/.test(n), 'amoladora', 'Amoladora angular', 'amoladora angular a batería'),
    R((p, n) => /AMM 500|MULTIMASTER/.test(n), 'sierra', 'Multiherramienta oscilante', 'multiherramienta oscilante'),
    R((p, n) => /SUPERCUT|AFSC/.test(n), 'sierra', 'Multiherramienta oscilante', 'multicortadora'),
    R((p, n) => /ASCD|IMPACTO/.test(n), 'llave-de-impacto', 'Atornillador de impacto', 'atornillador de impacto a batería'),
    R((p, n) => /ABH 18|ABSU|ASCM|TALADRO/.test(n), 'taladro', 'Taladro atornillador', 'taladro atornillador a batería'),
    R((p, n) => /\bASW ?1[48]-\d+.*(ANGULAR \d|ANGULAR 1,|ANGULAR 1\.|ANGULAR \d+ NM|ANGULAR \d+ A)/.test(n) && !/CABEZAL|PROTECTOR|FUNDA|PROLONG/.test(n), 'atornillador', 'Atornillador Angular', 'atornillador angular'),
    R((p, n) => /\bASM ?1[48]-\d+.*PISTOLA/.test(n) && !/FUNDA|SOPORTE/.test(n), 'atornillador', 'Atornillador Pistola', 'atornillador pistola'),
    R((p, n) => /BATERIA/.test(n) && !/FUNDA/.test(n), 'accesorio', 'Batería', 'batería'),
    R((p, n) => /CARGADOR/.test(n), 'accesorio', 'Cargador', 'cargador'),
    R((p, n) => /FUNDA|RECUBRIMIENTO/.test(n), 'accesorio', 'Funda', 'funda protectora'),
    R((p, n) => /PROTECTOR CABEZAL/.test(n), 'accesorio', 'Protector cabezal angular', 'protector de cabezal'),
    R((p, n) => /CABEZAL RECTO/.test(n), 'accesorio', 'Cabezal recto', 'cabezal recto'),
    R((p, n) => /CABEZAL/.test(n), 'accesorio', 'Cabezal angular', 'cabezal angular'),
    R((p, n) => /PROGRAMA|PARAMETER/.test(n), 'accesorio', 'Adaptador programación', 'programación'),
    R((p, n) => /LLAVE DE AJUSTE|HERRAMIENTA DE AJUSTE/.test(n), 'accesorio', 'Herramienta ajuste', 'llave de regulación de torque'),
    R(() => true, 'accesorio', null, 'accesorio FEIN'),
  ],
  FIAM: [
    R((p, n) => /MANTENIMIENTO|ALQUILER/.test(n), 'otros', 'Servicio', 'servicio, no producto'),
    R((p, n) => /REPUESTO|\bREP\b|FIAM\.?REP|\bPOS\b|SCREW \d|BLADE\/PALETTA|FIXED CLUTCH|KIT VALVULA|KIT DE VALVULA|PLANET SHAFT/.test(n), 'repuestos', 'Repuesto', 'repuesto'),
    R((p, n) => /AMOLADORA/.test(n), 'amoladora', 'Amoladora recta', 'amoladora neumática'),
    R((p, n) => /TALADRO|FSE26|FY10/.test(n), 'taladro', 'Taladro neumático', 'taladro neumático'),
    R((p, n) => /ROSCADORA|MAS6|MAY12/.test(n), 'taladro', 'Roscadora', 'roscadora'),
    R((p, n) => /LLAVE DE IMPULSO|IHE90/.test(n), 'llave-de-impacto', 'Llave de impulso', 'llave de impulso'),
    R((p, n) => /EQUILIBRADOR|BALANCEADOR/.test(n), 'balanceador', 'Balanceador', 'balanceador'),
    R((p, n) => /BRAZO|\bARM\b|BT-MG|\bBA\d+|BC\d+|SOPORTE DE BRAZO|TELESCOPIC/.test(n), 'accesorio', 'Brazo de reacción', 'brazo de reacción'),
    R((p, n) => /40A(17|20)AF\d+B/.test(n), 'punta', 'Embocadura', 'tubo para llave 40A'),
    R((p, n) => /SOCKET|-BIT\b|CABEZA ABIERTA|LSP3/.test(n) && !/-BIT-2CS|-BIT COD/.test(n), 'punta', null, 'tubo / cabeza para atornillador'),
    R((p, n) => /ROBOT|EASYDRIVE ALIMENTADOR DE TORNILLO \+/.test(n), 'atornillador', 'Sistema de atornillado', 'sistema de atornillado'),
    R((p, n) => /TOLVA|COLLAR BRACKET|ALIMENTADOR|TPU|TCS-B|UNIDAD DE (ALIMENTACION|MONITORIZ)|\bTOM\b|CABLE|GRIP|ACCESORIO PISTOLA|ESCAPE DE AIRE|GIRAPRISIONEROS|CABEZAL PARA EASYDRIVE|686903834/.test(n), 'accesorio', null, 'accesorio / control de atornillado'),
    R((p, n) => /MOTOR/.test(n), 'atornillador', 'Motor de atornillado', 'motor de atornillado'),
    // El resto de FIAM con modelo de herramienta (15C, 26C, 2W, AG60, IHE, CY, E8, MM, MO, A6RS…) son atornilladores.
    R((p, n) => /\b(\d{2}C\d|[23]W1|AG60|IHE|CY\d|E8|EASYDRIVE|ETENSIL|MM\d|MO\d|A\d+RSA|AD\d+RA|AS6R|CDE|CSE|MSCSE|40A\d|26A|28M|M0450|WINTOOLS|20MCS)/.test(n), 'atornillador', null, 'atornillador FIAM'),
  ],
  TOHNICHI: [
    // Los «#código» son piezas y accesorios sueltos: tubos y puntas van a
    // puntas, cables, fundas y grips a accesorios, lo demás es repuesto.
    R((p, n) => /^ ?TOHNICHI #/.test(n) && /SOCKET|\bBIT\b|ADAPTER|EXTENSION/.test(n), 'punta', null, 'tubo / punta TOHNICHI'),
    R((p, n) => /^ ?TOHNICHI #/.test(n) && /CABLE|CORD|CHARGER|HOLDER|SPANNER|\bCASE\b|\bBAG\b|STAND|COVER|GRIP|DIN RAIL|PAPER/.test(n), 'accesorio', null, 'accesorio TOHNICHI'),
    R((p, n) => /^ ?TOHNICHI #/.test(n), 'repuestos', 'Repuesto', 'repuesto TOHNICHI (#código)'),
    R((p, n) => /\b\d{2}T\d{4,}|PARA QSP|AIR HOSE JO/.test(n), 'repuestos', 'Repuesto', 'repuesto TOHNICHI'),
    R((p, n) => /CHARGER|BATTERY|AC ADAPTER/.test(n), 'accesorio', 'Cargador', 'cargador / batería'),
    R((p, n) => /ACCESSOR|SETTING BOX|MAGNET HOLDER/.test(n), 'accesorio', null, 'accesorio TOHNICHI'),
    R((p, n) => /RATCHET ADAPTER|SOCKET ADAPTER|^ ?TOHNICHI RA2?\s*$/.test(n), 'punta', 'Adaptador', 'adaptador'),
    R((p, n) => /^ ?TOHNICHI (SOCKET|BITS)\s*$/.test(n), 'punta', null, 'tubos / puntas'),
    R((p, n) => /^ ?TOHNICHI WEIGHT\s*$/.test(n), 'medicion', 'Calibración de torque', 'pesas de calibración'),
    R((p, n) => /EXTENSION CORD|^ ?TOHNICHI AC3\s*$/.test(n), 'accesorio', null, 'accesorio TOHNICHI'),
    R((p, n) => /PROTECTIVE COVER|-PCV\b/.test(n), 'accesorio', 'Funda', 'funda protectora'),
    R((p, n) => /\b(SH|RH|HH|QH|RQH|AH|DH|MSH|CPQH|FH|PH|BH)\d+D/.test(n) || /OPEN END|RING HEAD|HEX HEAD|RATCHET HEAD|INTERCHANGEABLE HEAD|ADJUSTABLE HEAD|SQUARE DRIVE HEAD|HOOK HEAD|NOTCH HEAD|CABEZA/.test(n) || /^ ?TOHNICHI (SH|RH|HH|QH|RQH|AH|DH|MSH|CPQH|FH|SH-N)\s*$/.test(n), 'llave-dinamometrica', 'Cabezal', 'cabezal intercambiable de torquímetro'),
    R((p, n) => /CALIBRAT|CALIBRR|TCL\b|TCL\d|DOTCL|TEST PIECE|TEST TABLE|TABLE ATTACHMENT|SLOTTED WEIGHT|WEIGHT SET|JOINT ROD|CALIBRATION STAND|REACTION UNIT|MOTOR DRIVEN KIT|LOADING DEVICE|DRILL CHUCK|\bTTF|\bATF\b|\bDTF\b|\bTP\d|\bTP\s*$|\bWP-/.test(n), 'medicion', 'Calibración de torque', 'equipo de calibración de torque'),
    R((p, n) => /TESTER|CHECKER|GAUGE|\bA?TGE?\d|\bB?TGE?\b|\bATG|\bBTG|TORQUE (METER|SENSOR|ANALYZER)|\bDOTE?\d|\bDOTE?\b|\b\d?-?TM\d|\bTM\s*$|\bTME|\bTCF|\bTCR|\bTCC|BTM|BOLT TENSION|\bFCON|\bCNA|BUZZER|\bLC\d|\bDLC|\bMT\d|\bTDT\d/.test(n), 'medicion', 'Medidor de torque', 'medidor / verificador de torque'),
    R((p, n) => /RECEIVER|TRANSMITTER|TRASMITTER|MODULE|PRINTER|DISPLAY|\bR-[A-Z]|\bT-[A-Z]|\bM-[A-Z]|\bEPP|\bCD\d|INTERFACE/.test(n) && !/WRENCH/.test(n), 'medicion', 'Comunicación y registro', 'transmisor / receptor / impresora'),
    R((p, n) => /DRIVER|\bRTD|\bFTD|\bLTD|\bSTC|\bCTD|\bMTD|\bSTD|\bAMRTD|\bRNTD|\bMNTD|\bNTD|\bRTDFH/.test(n), 'llave-dinamometrica', 'Destornillador Dinamométrico', 'destornillador dinamométrico'),
    R((p, n) => /BALANCER/.test(n), 'balanceador', 'Accesorio de balanceador', 'balanceador para herramienta'),
    R((p, n) => /ADJUSTING TOOL|ADJUSTING KEY/.test(n), 'accesorio', 'Herramienta ajuste', 'herramienta de ajuste'),
    // Todo lo demás de TOHNICHI son torquímetros (llaves, Spintork, Airtork…)
    // o la ficha de una familia de torquímetros (QL, CL, SP, QSP, CSP…).
    R(() => true, 'llave-dinamometrica', 'Llave dinamométrica', 'torquímetro'),
  ],
}

MARCA['INGERSOLL RAND'] = [
  R((p, n) => /SOFTWARE|LICENSE|ACTIVATION/.test(n), 'accesorio', 'Software', 'software de la herramienta'),
  R((p, n) => /\bRTS\d/.test(n), 'medicion', 'Medidor de torque', 'transductor de torque'),
  R((p, n) => /\bQX|NUTRUNNER/.test(n) && p.cat === 'otros', 'atornillador', null, 'atornillador QX'),
  R((p, n) => p.cat === 'otros' && /MAIN BOARD|\bBALL\b|GUIDE PIN|RETAINER/.test(n), 'repuestos', 'Repuesto', 'repuesto'),
]

// Reglas genéricas (para lo que no es de una marca prioritaria).
const GENERICAS = [
  R((p, n) => /\b(SERVICIO|MANTENIMIENTO PREVENTIVO|ALQUILER|FLETE|ENVIO A|HORAS? DE|MANO DE OBRA|CALIBRACION DE)\b/.test(n), 'otros', 'Servicio', 'servicio, no producto'),
  R((p, n) => ES_REPUESTO.test(n), 'repuestos', 'Repuesto', 'repuesto'),
  R((p, n) => /POLIPASTO|APAREJO|MALACATE|HOIST|IMAN ELEVADOR|CARRO DE TRASLACION/.test(n), 'elevacion', null, 'elevación de cargas'),
  R((p, n) => /AMOLADORA|GRINDER|ESMERILADORA|RECTIFICADORA/.test(n) && !/DISCO|PIEDRA|MUELA|CEPILLO|PARA AMOLADORA|ESMERILADA/.test(n), 'amoladora', null, 'amoladora'),
  R((p, n) => /LIJADORA|PULIDORA|POLISHER|\bSANDER\b/.test(n) && !/\bLIJA\b|DISCO|PAÑO|PANO/.test(n), 'amoladora', null, 'lijadora / pulidora'),
  R((p, n) => /TALADRO|ROTOMARTILLO|AGUJEREADORA|ROSCADORA/.test(n) && !/MECHA|BROCA|PASANTE|CINCEL|SDS PLUS PARA|PARA TALADRO|MANDRIL|DISCO|PADS/.test(n), 'taladro', null, 'taladro'),
  R((p, n) => /SIERRA (CIRCULAR|SENSITIVA|CALADORA|SABLE|SINFIN)|SIERRAS? CALADORAS|CP881|CORTA CHAPA NEUM|SIERRA CORTA CHAPA|CIZALLA INDUSTRIAL|SUPERCUT/.test(n) && !/HOJA|BANDA DENTADA|SET 6|PARA DISCOS|ANILLO/.test(n), 'sierra', null, 'sierra / corte'),
  R((p, n) => /LLAVE DE IMPULSO/.test(n), 'llave-de-impacto', 'Llave de impulso', 'llave de impulso'),
]

/**
 * El cajón de «Otros»: lo que no es de una marca de herramientas y se cargó
 * sin categoría. Palabra → categoría, en orden (la primera gana). Sólo se
 * aplica a lo que hoy está en «Otros» o «Pendiente de clasificación».
 */
const CAJON = [
  [/LLAVE DE TORQUE|TORQUIMETRO|TORQUE WRENCH|TORCOFIX|DINAMOMETRIC/, 'llave-dinamometrica', null, 'torquímetro'],
  [/CABEZA DE LLAVE|CABEZAL INTERCAMBIABLE/, 'llave-dinamometrica', 'Cabezal', 'cabezal de torquímetro'],
  [/\bMECHAS?\b|\bBROCAS?\b|SIERRA COPA|\bMACHOS? (DE ROSCAR|HSS|M\d)|JUEGO DE MACHOS|TERRAJA|AVELLANADOR|ESCARIADOR/, 'mechas', null, 'mecha / broca / macho'],
  [/\bDISCOS?\b.*(CORTE|DESBASTE|FLAP|ABRASIV|ESMERIL|LIJA)|\bLIJAS?\b|PUNTAS MONTADAS|PIEDRA (ESMERIL|AFILAR)|\bMUELA\b|PAÑO ABRASIVO|PANO ABRASIVO|SCOTCH ?BRITE|\bFIBRA ABRASIVA/, 'abrasivos', null, 'abrasivo'],
  [/\bCINTA (AISLADORA|AISLANTE)|TERMOCONTRAIBLE|\bTERMINAL(ES)?\b|PRECINTO|\bCABLE (CANAL|TIPO|UNIPOLAR|TALLER|SUBTERRANEO)|\bCABLECANAL|\bLAMPARA|\bLUMINARIA|\bREFLECTOR|\bPLAFON|\bTOMA ?CORRIENTE|\bTOMACORRIENTE|\bENCHUFE|\bFICHA (MACHO|HEMBRA)|\bLLAVE (TERMICA|DE LUZ|DE 1 PUNTO|DE UN PUNTO)|DISYUNTOR|TERMOMAGNETIC|CONTACTOR|\bRELE\b|\bPILOTO LUMINOSO|CAJA DE PASO|CAJA ESTANCA|CONEXBOX|\bBORNERA|\bBORNE\b|INTERRUPTOR|PULSADOR|\bSENSOR|\bFUENTE (DE ALIMENTACION|SWITCHING)|TRANSFORMADOR|\bPILAS?\b|BATERIA (AA|AAA|9V|CR\d)|LINTERNA|ZAPATILLA ELECTRICA|PROLONGADOR|ALARGUE|CAMBRE|SICK|IFM\b|REER|ELECTROVALVULA|\bVARIADOR|\bTEMPORIZADOR|\bDETECTOR/, 'electrico', null, 'eléctrico'],
  [/\bCINTA (ADHESIVA|DE EMBALAR|DOBLE FAZ|DE PAPEL|ENMASCAR|AMERICANA|PELIGRO|DEMARCA|ANTIDESLIZ|REFLECTIVA|METRICA)|\bCINTA\b(?!.*METRICA)/, 'pintureria', 'Cinta', 'cinta'],
  [/\bPINTURA|ESMALTE|AEROSOL|\bPINCEL|\bRODILLO|DILUYENTE|THINNER|MASILLA|ENDUIDO|ANTIOXIDO|\bSPRAY\b/, 'pintureria', null, 'pinturería'],
  [/\bCAÑO|\bCANO\b|\bTUBERIA|\bCODO\b|\bCUPLA|\bNIPLE|\bREDUCCION|\bUNION DOBLE|\bTEE\b|\bCURVA\b|\bGRIFERIA|\bCANILLA|\bBOMBA (DE AGUA|SUMERGIBLE|CENTRIFUGA)|\bBOMBA\b|\bFLOTANTE|\bTANQUE DE AGUA|\bPVC\b|\bAWADUCT|\bTERMOFUSION/, 'conduccion', null, 'conducción de fluidos'],
  [/CANCAMO|\bTORNILLOS?\b|\bTUERCAS?\b|\bARANDELAS?\b|\bBULON|\bPERNO|\bTARUGO|\bANCLAJE|\bREMACHES?\b|\bABRAZADERA|\bGRAMPA|\bPRISIONERO|\bVARILLA ROSCADA|\bESPARRAGO|\bCLAVOS?\b|\bMOSQUETON|\bGRILLETE|\bTENSOR\b|\bESLINGA|\bCABLE DE ACERO|\bBISAGRA|\bCANDADO|\bPASADOR/, 'fijaciones', null, 'fijación / sujeción'],
  [/\bGUANTES?\b|\bANTEOJO|\bLENTES? DE SEGURIDAD|\bCASCO\b|\bBARBIJO|\bMASCARA|\bRESPIRADOR|\bPROTECTOR (AUDITIVO|FACIAL)|\bTAPON(ES)? AUDITIVO|\bARNES|\bBOTIN|\bZAPATO|\bCALZADO|\bDELANTAL|\bCAMPERA|\bCHALECO|\bMAMELUCO|\bBUZO\b|\bPANTALON|\bCAMISA|\bREMERA|\bOVEROL|\bFAJA\b|\bRODILLERA|\bMANGA\b|\bPROTECCION/, 'seguridad', null, 'protección personal'],
  [/\bMULTIMETRO|\bTESTER\b|\bPINZA AMPEROMETRICA|\bCALIBRE\b|\bMICROMETRO|\bCOMPARADOR|\bNIVEL\b|\bESCUADRA|\bREGLA\b|\bCINTA METRICA|\bFLEXOMETRO|\bMEDIDOR|\bMANOMETRO|\bTERMOMETRO|\bTERMOHIGROMETRO|\bLUXOMETRO|\bBALANZA|\bTELUROMETRO|\bTACOMETRO|\bTENSIOMETRO|\bGALGA|\bPIROMETRO|\bDECIBELIMETRO|\bANEMOMETRO|\bREGISTRADOR|\bOSCILOSCOPIO|\bMEGOHMETRO|\bVOLTIMETRO|\bAMPERIMETRO/, 'medicion', null, 'medición'],
  [/\bMANGUERA|\bACOPLE RAPIDO|\bRACOR|\bCONECTOR RAPIDO|\bVALVULA|\bREGULADOR (DE PRESION|DE AIRE)|\bFILTRO (DE AIRE|REGULADOR)|\bLUBRICADOR|\bCILINDRO NEUMATICO|\bPISTOLA (DE AIRE|SOPLADORA|DE INFLAR)|\bSOPLETE PINTAR|\bCOMPRESOR|\bUNIDAD FRL|\bSILENCIADOR/, 'neumatica', null, 'neumática'],
  [/\bADHESIVO|\bPEGAMENTO|\bSELLADOR|\bSILICONA|\bLUBRICANTE|\bACEITE|\bGRASA|\bDESENGRASANTE|\bPENETRANTE|\bWD-?40|\bLOCTITE|\bALCOHOL|\bLIMPIADOR|\bSOLVENTE|\bDESINFECTANTE|\bDESINCRUSTANTE|\bLAVANDINA|\bDETERGENTE|\bTINTA\b|\bRESINA|\bEPOXI|\bQUITA ?SARRO|\bANTICORROSIVO/, 'quimicos', null, 'químico'],
  [/\bESCOBA|\bESCOBILLON|\bSECADOR\b|\bBALDE|\bTRAPO|\bREJILLA|\bFRANELA|\bESPONJA|\bCEPILLO(?! DE ALAMBRE)|\bPALA\b|\bCESTO|\bBOLSAS? (DE RESIDUO|DE CONSORCIO|PARA RESIDUO)|\bTACHO|\bPAPEL (HIGIENICO|DE MANOS|TISSUE)|\bTOALLA|\bDISPENSER|\bALFOMBRA|\bTRAPEADOR|\bMOPA|\bMICROFIBRA/, 'limpieza', null, 'limpieza'],
  [/\bCAJA (ORGANIZADORA|DE HERRAMIENTAS|PLASTICA|PARA HERRAMIENTAS)|\bGAVETA|\bCONTENEDOR|\bBATEA|\bBANDEJA|\bORGANIZADOR|\bPORTA ?HERRAMIENTAS|\bRACK\b|\bESTANTE|\bESTANTERIA|\bBIN\b|\bBINES/, 'almacenamiento', null, 'almacenamiento'],
  [/\bSILLA|\bMESA\b|\bBANCO DE TRABAJO|\bARMARIO|\bLOCKER|\bESCRITORIO|\bCARRO\b|\bZORRA|\bCARRETILLA|\bESCALERA|\bPIZARRA|\bTABURETE|\bBANQUETA|\bVENTILADOR|\bESPEJO/, 'mobiliario', null, 'mobiliario / equipamiento'],
  [/\bELECTRODO|\bESTAÑO|\bESTANO|\bSOLDADORA|\bSOLDADURA|\bVARILLA DE APORTE|\bALAMBRE MIG|\bMATERIAL DE APORTE|\bAPORTE\b|\bSOPLETE|\bGARRAFA|\bCARETA DE SOLDAR|\bPINZA PORTAELECTRODO/, 'soldadura', null, 'soldadura'],
  [/\bALICATE|\bPINZA\b|\bMARTILLO|\bMAZA\b|\bDESTORNILLADOR|\bLLAVE (FIJA|COMBINADA|FRANCESA|STILSON|AJUSTABLE|ALLEN|TORX|DE TUBO|ESTRELLA|CRIQUE)|\bJUEGO DE LLAVES|\bLLAVES ALLEN|\bCRIQUE|\bLIMA\b|\bESCOFINA|\bCINCEL|\bPUNZON|\bSERRUCHO|\bARCO DE SIERRA|\bTIJERA|\bCUTTER|\bTRINCHETA|\bESPATULA|\bMORSA|\bPRENSA\b|\bSARGENTO|\bEXTRACTOR|\bREMACHADORA MANUAL|\bPISTOLA DE CALOR|\bPISTOLA ENCOLADORA|\bPISTOLA DE SILICONA|\bBOCALLAVE|\bLLAVE\b/, 'herramientas-manuales', null, 'herramienta de mano'],
  [/\bPUNTAS?\b|\bBITS?\b|\bTUBO HEXAGONAL|\bTUBOS? (DE IMPACTO|PARA IMPACTO)|\bJUEGO DE TUBOS|\bPORTAPUNTAS|\bEXTENSION (PARA|DE) (LLAVE|TUBO)/, 'punta', null, 'punta / tubo'],
]

const CAJON_REGLAS = CAJON.map(([re, cat, tipo, razon]) => R((p, n) => re.test(n), cat, tipo, razon))

const propuestas = []
for (const p of P) {
  const n = NOM(p)
  const reglas = MARCA[p.marca] ?? GENERICAS
  // Las genéricas sólo se aplican a lo que está mal guardado o sin clasificar,
  // o cuando el producto dice claramente otra cosa.
  // Una marca con reglas propias que no acierta ninguna cae en las genéricas.
  const enCajon = p.cat === 'otros' || p.cat === 'pendiente-clasificacion-stel'
  let origen = MARCA[p.marca] ? 'marca' : 'generica'
  let regla = reglas.find((r) => r.test(p, n))
  if (!regla && reglas !== GENERICAS) {
    regla = GENERICAS.find((r) => r.test(p, n))
    origen = 'generica'
  }
  if (!regla && enCajon) {
    regla = CAJON_REGLAS.find((r) => r.test(p, n))
    origen = 'cajon'
  }
  if (!regla) continue
  let cat = regla.cat
  let tipo = regla.tipo
  if (cat === 'punta' && !tipo) tipo = p.tipo && p.tipo !== 'Punta' ? p.tipo : tipoDePunta(n) ?? p.tipo
  // Un atornillador sin tipo: si el nombre dice cómo es, se dice.
  if (cat === 'atornillador' && !tipo && !p.tipo) {
    if (/PISTOLA|PISTOL/.test(n)) tipo = 'Atornillador Pistola'
    else if (/ANGULAR|ANGLE/.test(n)) tipo = /NEUMATIC/.test(n) || p.marca === 'FIAM' ? 'Atornillador Angular Neumático' : 'Atornillador Angular'
    else if (/RECTO|INLINE|STRAIGHT/.test(n)) tipo = 'Atornillador Recto Neumático'
  }
  // Las máquinas de las categorías nuevas: el tipo sale del nombre.
  if (['amoladora', 'taladro', 'sierra', 'elevacion'].includes(cat) && !regla.tipo) {
    const T = {
      amoladora: [[/BANCO/, 'Amoladora de banco'], [/RECTIFICADORA/, 'Rectificadora'], [/RECTA|PINZA|MATRICES/, 'Amoladora recta'], [/LIJADORA|SANDER/, 'Lijadora'], [/PULIDORA|POLISHER|ROLOC/, 'Pulidora'], [/AMOLADORA|GRINDER/, 'Amoladora angular']],
      taladro: [[/ROTOMARTILLO/, 'Rotomartillo'], [/BASE MAGNETICA/, 'Taladro de base magnética'], [/BANCO|DE PIE/, 'Taladro de banco'], [/NEUMATIC/, 'Taladro neumático'], [/ROSCADORA/, 'Roscadora'], [/ATORNILLADOR/, 'Taladro atornillador'], [/PERCUTOR/, 'Taladro percutor'], [/TALADRO/, 'Taladro']],
      sierra: [[/SENSITIVA/, 'Sierra sensitiva'], [/CIRCULAR/, 'Sierra circular'], [/CALADORA/, 'Sierra caladora'], [/CORTA CHAPA|CIZALLA|CP7901/, 'Cizalla corta chapa'], [/SIERRA|CP881/, 'Sierra neumática']],
      elevacion: [[/IMAN/, 'Imán elevador'], [/CARRO/, 'Carro para aparejo'], [/PALANCA/, 'Aparejo manual'], [/NEUMATIC/, 'Polipasto neumático'], [/POLIPASTO|APAREJO|MALACATE|HOIST/, 'Polipasto eléctrico']],
    }[cat]
    tipo = T.find(([r]) => r.test(n))?.[1] ?? null
  }
  // Un tipo que era de la categoría anterior y ya no corresponde, no viaja.
  if (!tipo && p.tipo && cat !== p.cat && ['Plana', 'Allen', 'Tornillo', 'Repuesto', 'Embocadura', 'Phillips', 'Punta'].includes(p.tipo)) tipo = null
  else if (!tipo) tipo = p.tipo
  // Las genéricas no sacan a nadie de su categoría salvo hacia repuestos
  // desde «otros»/«pendiente», o hacia una categoría nueva de máquinas.
  if (!MARCA[p.marca]) {
    const nueva = ['amoladora', 'taladro', 'sierra', 'elevacion'].includes(cat)
    const desdeCajon = ['otros', 'pendiente-clasificacion-stel', 'accesorio', 'herramientas-manuales', 'balanceador', 'punta', 'pintureria', 'abrasivos', 'mobiliario'].includes(p.cat)
    if (cat === 'repuestos' && !['otros', 'pendiente-clasificacion-stel'].includes(p.cat)) continue
    if (nueva && !desdeCajon) continue
    if (cat === 'otros' && p.cat !== 'otros' && p.cat !== 'pendiente-clasificacion-stel') continue
  }
  if (cat === p.cat && (tipo ?? null) === (p.tipo ?? null)) continue
  propuestas.push({ id: p.id, sku: p.sku, marca: p.marca, nombre: p.nombre, de: p.cat, a: cat, tipoDe: p.tipo, tipoA: tipo ?? null, razon: regla.razon, origen, publico: p.publico })
}

writeFileSync(`revision/categorias/propuesta-${empresa}.json`, JSON.stringify(propuestas, null, 1))
const resumen = {}
for (const x of propuestas) {
  const k = `${x.marca ?? '∅'} · ${x.de} → ${x.a}${x.de === x.a ? ' (sólo tipo)' : ''}`
  resumen[k] = (resumen[k] ?? 0) + 1
}
console.log(propuestas.length, 'cambios propuestos')
for (const [k, v] of Object.entries(resumen).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k)
