const SB_URL = 'https://aonequdtprbhviskbvrw.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvbmVxdWR0cHJiaHZpc2tidnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjQwODAsImV4cCI6MjA5MjcwMDA4MH0.aUxe_pUwYTkR8iRoeESAAsKVF264yFvojE7_4rZEyu4';
const r1 = await fetch(`${SB_URL}/functions/v1/phone-password-login`, { method: 'POST', headers: {'Content-Type':'application/json', apikey: ANON, Authorization:`Bearer ${ANON}`}, body: JSON.stringify({ phone: '15120857030', password: 'TestPwd@2026' }) });
const j1 = await r1.json();
const token = j1.access_token;
console.log('TOKEN', token.slice(0,20));
