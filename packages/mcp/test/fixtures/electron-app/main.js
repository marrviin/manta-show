const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600 });
  win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        '<body style="font-family:sans-serif;background:#f4f4f5;padding:32px">' +
          '<h1 id="title">Manta Electron Demo</h1>' +
          '<button id="btn" onclick="document.getElementById(\'title\').textContent=\'Clicked!\'">Click me</button>' +
          '</body>',
      ),
  );
});
