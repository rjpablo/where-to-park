const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function verifyScreenshot(filepath) {
  const filename = filepath.split('/').pop();
  console.log(`\nVerifying ${filename}...`);
  
  // Check file exists and size
  const stats = fs.statSync(filepath);
  console.log(`  Size: ${(stats.size / 1024).toFixed(1)}KB`);
  
  if (stats.size < 5000) {
    console.log(`  ⚠ Warning: Very small file, might be blank/error`);
    return false;
  }
  
  // Use ImageMagick identify to check image properties
  try {
    const { stdout } = await execAsync(`identify -format "%wx%h %k colors" "${filepath}"`);
    console.log(`  Dimensions & colors: ${stdout.trim()}`);
    
    const [dims, colors] = stdout.trim().split(' ');
    const colorCount = parseInt(colors);
    
    if (colorCount < 50) {
      console.log(`  ⚠ Warning: Only ${colorCount} colors, likely blank/error screen`);
      return false;
    }
    
    console.log(`  ✓ Valid screenshot`);
    return true;
  } catch (error) {
    console.log(`  ✗ Error checking image: ${error.message}`);
    return false;
  }
}

async function main() {
  const dir = '/opt/cursor/artifacts/screenshots';
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.png') && f.match(/^\d/))
    .sort()
    .map(f => `${dir}/${f}`);
  
  console.log(`Found ${files.length} screenshots to verify`);
  
  let validCount = 0;
  for (const file of files) {
    if (await verifyScreenshot(file)) {
      validCount++;
    }
  }
  
  console.log(`\n=== Summary: ${validCount}/${files.length} valid screenshots ===`);
}

main().catch(console.error);
