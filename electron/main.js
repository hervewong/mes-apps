const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const slug = require('../package.json').radioApp;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'site', slug, 'icon-512.png'),
    webPreferences: { autoplayPolicy: 'no-user-gesture-required' },
  });
  win.loadFile(path.join(__dirname, '..', 'site', slug, 'index.html'));
  // Les liens externes s'ouvrent dans le navigateur, pas dans l'application
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

Menu.setApplicationMenu(null);
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
