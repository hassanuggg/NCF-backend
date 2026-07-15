const { exec } = require('child_process');
exec('netstat -ano | findstr ":3000"', (err, stdout) => {
  if (err || !stdout) return console.log('none');
  console.log(stdout.trim());
});
