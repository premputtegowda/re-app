// Script to generate PNG icons from SVG
// Run with: node generate-icons.js

const fs = require('fs');
const path = require('path');

console.log('📱 PWA Icon Generator');
console.log('===================\n');

console.log('For now, you have two options to generate PNG icons:\n');

console.log('Option 1: Use an online converter');
console.log('  1. Go to https://cloudconvert.com/svg-to-png');
console.log('  2. Upload public/icon.svg');
console.log('  3. Convert to PNG with these sizes:');
console.log('     - 192x192 → save as public/icon-192.png');
console.log('     - 512x512 → save as public/icon-512.png\n');

console.log('Option 2: Use ImageMagick (if installed)');
console.log('  Run these commands:');
console.log('  convert public/icon.svg -resize 192x192 public/icon-192.png');
console.log('  convert public/icon.svg -resize 512x512 public/icon-512.png\n');

console.log('Option 3: Use an online favicon generator');
console.log('  1. Go to https://realfavicongenerator.net/');
console.log('  2. Upload public/icon.svg');
console.log('  3. Download all generated icons');
console.log('  4. Copy icon-192.png and icon-512.png to public/\n');

// Create placeholder files for development
const createPlaceholder = (size) => {
  const placeholderSVG = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#3B82F6"/>
    <text x="50%" y="50%" font-family="Arial" font-size="48" fill="white" text-anchor="middle" dominant-baseline="middle">REPS</text>
  </svg>`;

  const filename = `icon-${size}.svg`;
  fs.writeFileSync(path.join(__dirname, 'public', filename), placeholderSVG);
  console.log(`✅ Created placeholder: public/${filename}`);
};

createPlaceholder(192);
createPlaceholder(512);

console.log('\n✨ Placeholder SVG icons created!');
console.log('📝 For production, please generate proper PNG icons using one of the options above.\n');
