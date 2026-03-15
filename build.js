const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const CLIENT_DIR = 'client/js';
const BUILD_DIR = 'public/js/dist';

// Ensure build directory exists
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

// Order matters - dependencies first, then main app
const mainAppFiles = [
  'AuthService.js',
  'SignalingClient.js',
  'MediaManager.js',
  'UIManager.js',
  'WHIPClient.js',
  'WHEPClient.js',
  'WebRTCManager.js',
  'SoloView.js',
  'DirectorView.js',
  'IframeAPI.js',
  'app.js'
];

async function buildMainApp() {
  console.log('Building main app bundle...\n');

  // Concatenate all files in order
  let combined = '';
  for (const file of mainAppFiles) {
    const content = fs.readFileSync(path.join(CLIENT_DIR, file), 'utf-8');
    combined += `/* ===== ${file} ===== */\n${content}\n`;
  }

  // Write combined file temporarily
  const tempFile = path.join(BUILD_DIR, '_temp_combined.js');
  fs.writeFileSync(tempFile, combined);

  try {
    // Minify the combined file
    await esbuild.build({
      entryPoints: [tempFile],
      outfile: path.join(BUILD_DIR, 'app.bundle.min.js'),
      minify: true,
      sourcemap: false,
      bundle: true,
      format: 'iife',
      target: 'es2020',
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      legalComments: 'none'
    });

    // Clean up temp file
    fs.unlinkSync(tempFile);

    console.log('✓ Built: app.bundle.min.js (includes all dependencies)');
  } catch (error) {
    fs.unlinkSync(tempFile);
    console.error('Failed to build main app:', error.message);
    process.exit(1);
  }
}

async function buildAdminApp() {
  console.log('Building admin dashboard bundle...\n');

  try {
    await esbuild.build({
      entryPoints: [path.join(CLIENT_DIR, 'AdminDashboard.js')],
      outfile: path.join(BUILD_DIR, 'AdminDashboard.bundle.min.js'),
      minify: true,
      sourcemap: false,
      bundle: true,
      format: 'iife',
      target: 'es2020',
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      legalComments: 'none'
    });

    console.log('✓ Built: AdminDashboard.bundle.min.js');
  } catch (error) {
    console.error('Failed to build admin app:', error.message);
    process.exit(1);
  }
}

async function buildDirectorApp() {
  console.log('Building director dashboard bundle...\n');

  try {
    await esbuild.build({
      entryPoints: [path.join(CLIENT_DIR, 'DirectorDashboard.js')],
      outfile: path.join(BUILD_DIR, 'DirectorDashboard.bundle.min.js'),
      minify: true,
      sourcemap: false,
      bundle: true,
      format: 'iife',
      target: 'es2020',
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      legalComments: 'none'
    });

    console.log('✓ Built: DirectorDashboard.bundle.min.js');
  } catch (error) {
    console.error('Failed to build director app:', error.message);
    process.exit(1);
  }
}

async function buildCSS() {
  console.log('Building CSS bundles...\n');

  const cssDir = 'client/css';
  const outputDir = 'public/css';

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const cssFiles = ['index.css', 'admin.css'];

  for (const file of cssFiles) {
    try {
      await esbuild.build({
        entryPoints: [path.join(cssDir, file)],
        outfile: path.join(outputDir, file.replace('.css', '.min.css')),
        minify: true,
        bundle: true,
        loader: { '.css': 'css' }
      });

      console.log(`✓ Built: ${file.replace('.css', '.min.css')}`);
    } catch (error) {
      console.error(`Failed to build ${file}:`, error.message);
      process.exit(1);
    }
  }
}

async function buildAll() {
  await buildMainApp();
  await buildAdminApp();
  await buildDirectorApp();
  await buildCSS();

  console.log('\n✓ Production build complete!');
  console.log('\nFiles are now minified and obfuscated.');

  // Show file sizes
  const files = ['app.bundle.min.js', 'AdminDashboard.bundle.min.js', 'DirectorDashboard.bundle.min.js'];
  console.log('\nBundle sizes:');
  files.forEach(f => {
    const filePath = path.join(BUILD_DIR, f);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`  - ${f}: ${sizeKB} KB`);
    }
  });

  // Show CSS file sizes
  const cssFiles = ['index.min.css', 'admin.min.css'];
  console.log('\nCSS bundles:');
  cssFiles.forEach(f => {
    const filePath = path.join('public/css', f);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`  - ${f}: ${sizeKB} KB`);
    }
  });
}

buildAll();
