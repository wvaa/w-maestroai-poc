// ==========================================================================
// Llama al servicio de reverse de ANDA usando los valores recuperados por
// fetch-service-payment.js (disponibles en el objeto global "output").
//
// Escrito en ES5 por compatibilidad con el motor Rhino de Maestro.
// Se ejecuta con:  - runScript: post-reverse-anda.js
//
// Mapeo desde service-payment:
//   ssn                   -> numReferenceBank
//   correlativo_collector -> serviceReference
//   prodtype_from         -> productType
//
// Los demas campos (inputData, paymentInfo, totalAmount, concept, etc.) NO
// vienen del servicio service-payment; se toman de variables inyectadas o de
// los valores por defecto del curl de referencia. Ajustalos segun el caso.
//
// Equivalente a:
//   curl --location 'https://transversalesuat.bancocuscatlan.com/anda-entity/api/v1/reverse' \
//     --header 'Accept-Language: es' \
//     --header 'Content-Type: application/json' \
//     --data '{ "serviceIdentifier": "2001", "inputData": { "contrato": "00836453" }, ... }'
// ==========================================================================

var reverseUrl = (typeof REVERSE_ANDA_URL !== 'undefined' && REVERSE_ANDA_URL)
  ? REVERSE_ANDA_URL
  : 'https://transversalesuat.bancocuscatlan.com/anda-entity/api/v1/reverse';

// --- Valores tomados del servicio service-payment (via output) ---
var numReferenceBank = output.numReferenceBank;   // ssn
var serviceReference = output.serviceReference;   // correlativo_collector
var productType = output.prodtype_from;           // prodtype_from

// --- Valores propios de ANDA (configurables o por defecto del curl) ---
var serviceIdentifier = (typeof ANDA_SERVICE_IDENTIFIER !== 'undefined' && ANDA_SERVICE_IDENTIFIER) ? ANDA_SERVICE_IDENTIFIER : '2001';
var contrato = (typeof CONTRATO !== 'undefined' && CONTRATO) ? CONTRATO : '00836453';
var totalAmount = (typeof TOTAL_AMOUNT !== 'undefined' && TOTAL_AMOUNT) ? TOTAL_AMOUNT : 2.39;
var currency = (typeof CURRENCY !== 'undefined' && CURRENCY) ? CURRENCY : 'USD';
var concept = (typeof CONCEPT !== 'undefined' && CONCEPT) ? CONCEPT : 'Paying bill - ANDA test';
var productIdentifier = (typeof PRODUCT_IDENTIFIER !== 'undefined' && PRODUCT_IDENTIFIER) ? PRODUCT_IDENTIFIER : 'PRD12365400';

var payload = {
  serviceIdentifier: serviceIdentifier,
  inputData: {
    contrato: contrato
  },
  paymentInfo: [
    {
      amount: {
        item: 'Monto',
        value: '2.39',
        nameID: 'Monto',
        currencyCode: 'USD'
      },
      details: [
        {
          item: 'No. de asociación',
          value: '00836453',
          nameID: 'Cuenta'
        },
        {
          item: 'Descripción',
          value: 'RUPERTO FLORES SALVADOR',
          nameID: 'DescripcionDeuda'
        },
        {
          item: 'Fecha de cargo',
          value: '17/09/2024',
          nameID: 'FechaCargo'
        }
      ],
      seeMore: []
    }
  ],
  totalAmount: totalAmount,
  currency: currency,
  concept: concept,
  productIdentifier: productIdentifier,
  productType: productType,
  numReferenceBank: numReferenceBank,
  serviceReference: serviceReference
};

console.log('serviceIdentifier = ' + payload.serviceIdentifier);
console.log('productType = ' + payload.productType);
console.log('numReferenceBank = ' + payload.numReferenceBank);
console.log('serviceReference = ' + payload.serviceReference);

var reverse = http.post(reverseUrl, {
  headers: {
    'Accept-Language': 'es',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});

// Guarda la respuesta por si se necesita en pasos posteriores.
// (Se asigna e imprime ANTES del chequeo de error para que el status/body
// sean visibles en consola tambien cuando el reverse falla.)
output.reverseAndaStatus = reverse.status;
output.reverseAndaBody = reverse.body;

console.log('reverse.status = ' + output.reverseAndaStatus);
console.log('reverse.body = ' + output.reverseAndaBody);

if (!reverse.ok) {
  throw new Error('reverse ANDA devolvio status ' + reverse.status + ': ' + reverse.body);
}
