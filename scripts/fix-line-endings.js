/**
 * fix-line-endings.js
 * Convierte todos los archivos YAML en flows/ de CRLF a LF.
 * Esto es necesario porque BrowserStack (Linux) puede fallar
 * al parsear archivos YAML con line endings de Windows (CRLF).
 */
const fs = require('fs');
const path = require('path');

function fixDir(dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      fixDir(fullPath);
    } else if (/\.ya?ml$/i.test(item.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const fixed = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (content !== fixed) {
        fs.writeFileSync(fullPath, fixed, 'utf8');
        console.log(`Fixed: ${path.relative(process.cwd(), fullPath)}`);
      } else {
        console.log(`OK:    ${path.relative(process.cwd(), fullPath)}`);
      }
    }
  }
}

const flowsDir = path.resolve(process.cwd(), 'flows');
if (!fs.existsSync(flowsDir)) {
  console.error('No se encontró la carpeta flows/');
  process.exit(1);
}

fixDir(flowsDir);
console.log('\nDone. All YAML files now use LF line endings.');
