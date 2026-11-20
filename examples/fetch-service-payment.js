// ==========================================================================
// Recupera el ultimo registro de service-payment desde el servicio HTTP y
// guarda los valores en el objeto global "output" para pasos posteriores.
//
// Escrito en ES5 por compatibilidad con el motor Rhino de Maestro.
// Se ejecuta con:  - runScript: fetch-service-payment.js
//
// Variables opcionales (parametros/constantes de Maestro):
//   SERVICE_URL, USRNAME, COLLECTOR_ID
// ==========================================================================

// NOTA: en archivos .js ejecutados con runScript, Maestro inyecta las
// variables como identificadores globales (USRNAME, COLLECTOR_ID, ...).
// NO interpola ${...}, por eso los valores por defecto son literales reales.
var baseUrl = (typeof SERVICE_URL !== 'undefined' && SERVICE_URL) ? SERVICE_URL : 'http://0.0.0.0:3000';
var usrname = (typeof USRNAME !== 'undefined' && USRNAME) ? USRNAME : 'trejo77';
// collectorId: filtra los datos en la BD (columna collector_id).
var collectorId = (typeof COLLECTOR_ID !== 'undefined' && COLLECTOR_ID) ? COLLECTOR_ID : '2010';
// serviceIdentifier: identificador del servicio de reversal en AES. Es un
// valor propio del backend AES (ej. 2010) y NO tiene por que coincidir con el
// collector_id con el que se filtra la BD. Ajustalo segun corresponda.
var serviceIdentifier = (typeof SERVICE_IDENTIFIER !== 'undefined' && SERVICE_IDENTIFIER) ? SERVICE_IDENTIFIER : '2010';

// Equivalente a:
//   curl --location '0.0.0.0:3000/service-payment?usrname=trejo77&collector_id=2001&latest=true'
var url = baseUrl + '/service-payment?usrname=' + encodeURIComponent(usrname) + '&latest=true';
if (collectorId) {
  url = url + '&collector_id=' + encodeURIComponent(collectorId);
}

var response = http.get(url);

if (!response.ok) {
  throw new Error('service-payment devolvio status ' + response.status);
}

// Con latest=true la respuesta es un objeto (o null si no hay registros).
var latest = json(response.body);
if (!latest) {
  throw new Error('No hay registros de service_payment para el usuario ' + usrname);
}

output.ssn = latest.ssn;
output.correlativo_collector = latest.correlativo_collector;
output.collector_id = latest.collector_id;
output.prodtype_from = latest.prodtype_from;

// Mapeo a los campos usados por los colectores.
output.numReferenceService = latest.correlativo_collector; // AES: ej. BCO_CUSCATLAN...
output.numReferenceBank = latest.ssn;                       // ANDA
output.serviceReference = latest.correlativo_collector;     // ANDA
// serviceIdentifier del reversal: valor propio de AES (no es el collector_id
// del registro). Por defecto 2010, como en el curl de referencia.
output.serviceIdentifier = serviceIdentifier;

// Imprime en consola los valores recuperados y mapeados.
console.log('ssn = ' + output.ssn);
console.log('correlativo_collector = ' + output.correlativo_collector);
console.log('collector_id = ' + output.collector_id);
console.log('prodtype_from = ' + output.prodtype_from);
console.log('numReferenceService = ' + output.numReferenceService);
console.log('numReferenceBank = ' + output.numReferenceBank);
console.log('serviceReference = ' + output.serviceReference);
console.log('serviceIdentifier = ' + output.serviceIdentifier);
console.log('prodtype_from = ' + output.prodtype_from);


