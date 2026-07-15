const { exec } = require('child_process');

exec('netstat -ano | findstr ":3000"', (err, stdout) => {
  if (err || !stdout) {
    console.log('none');
    return;
  }
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) { console.log('none'); return; }
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    try {
      process.kill(pid);
      console.log('killed:' + pid);
    } catch (e) {
      try {
        require('child_process').execSync('taskkill /PID ' + pid + ' /F');
        console.log('killed:' + pid);
      } catch (err2) {
        console.error('kill failed', pid, err2.message);
      }
    }
  });
});
