// ==========================================================================
// Llama al servicio de reversal (AES) usando los valores recuperados por
// fetch-service-payment.js (disponibles en el objeto global "output").
//
// Escrito en ES5 por compatibilidad con el motor Rhino de Maestro.
// Se ejecuta con:  - runScript: post-reversal.js
//
// Equivalente a:
//   curl --location 'https://serviciosdigitalesuat.bancocuscatlan.com/aes-entity/api/v1/reversal' \
//     --header 'channel: 10' \
//     --header 'Accept-Language: es' \
//     --header 'platform: APP' \
//     --header 'iso-country: SV' \
//     --header 'encrypt-info: false' \
//     --header 'Content-Type: application/json' \
//     --data '{ "serviceIdentifier": "2010", "numReferenceService": "BCO_CUSCATLAN20260901370105052" }'
// ==========================================================================

// serviceIdentifier: se toma del output que dejo fetch-service-payment.js.
// Como respaldo, si el output no lo trae, se usa la variable SERVICE_IDENTIFIER
// inyectada al script (por si se ejecuta post-reversal.js de forma aislada).
var serviceIdentifier = output.serviceIdentifier;
if (!serviceIdentifier && typeof SERVICE_IDENTIFIER !== 'undefined' && SERVICE_IDENTIFIER) {
  serviceIdentifier = SERVICE_IDENTIFIER;
}

console.log('serviceIdentifier = ' + serviceIdentifier);
console.log('numReferenceService = ' + output.numReferenceService);

var reversalUrl = (typeof REVERSAL_URL !== 'undefined' && REVERSAL_URL)
  ? REVERSAL_URL
  : 'https://serviciosdigitalesuat.bancocuscatlan.com/aes-entity/api/v1/reversal';

var payload = {
  serviceIdentifier: serviceIdentifier,
  numReferenceService: output.numReferenceService
};

var reversal = http.post(reversalUrl, {
  headers: {
    'channel': '10',
    'Accept-Language': 'es',
    'platform': 'APP',
    'iso-country': 'SV',
    'encrypt-info': 'false',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});

// Guarda la respuesta del reversal por si se necesita en pasos posteriores.
// (Se asigna e imprime ANTES del chequeo de error para que el status/body
// sean visibles en consola tambien cuando el reversal falla.)
output.reversalStatus = reversal.status;
output.reversalBody = reversal.body;

console.log('reversal.status = ' + output.reversalStatus);
console.log('reversal.body = ' + output.reversalBody);

if (!reversal.ok) {
  throw new Error('reversal devolvio status ' + reversal.status + ': ' + reversal.body);
}
