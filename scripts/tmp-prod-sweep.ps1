$px = 'http://127.0.0.1:12334'
$checks = @(
  @{ u = 'https://knowyourself.cc.cd/healthz';               expect = 'ok' },
  @{ u = 'https://knowyourself.cc.cd/assessments/';          expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/community/';            expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/journal/';              expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/privacy/';              expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/complaints/';           expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/history/';              expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/bookmarks/';            expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/account/';              expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/test/mbti/';            expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/quiz/mbti/';            expect = '200' },
  @{ u = 'https://knowyourself.cc.cd/api/auth/get-session';  expect = 'null' },
  @{ u = 'https://knowyourself.cc.cd/api/config/turnstile';  expect = 'json' },
  @{ u = 'https://knowyourself.cc.cd/robots.txt';            expect = 'sitemap' },
  @{ u = 'https://www.knowyourself.cc.cd/';                  expect = '301' },
  @{ u = 'https://loveyourself.cc.cd/';                      expect = '301' }
)
foreach ($c in $checks) {
  try {
    $r = Invoke-WebRequest -Uri $c.u -Proxy $px -UseBasicParsing -TimeoutSec 30 -MaximumRedirection 0 -ErrorAction SilentlyContinue
    $code = [int]$r.StatusCode
  } catch {
    $code = [int]$_.Exception.Response.StatusCode
  }
  $body = ''
  try { $body = (Invoke-WebRequest -Uri $c.u -Proxy $px -UseBasicParsing -TimeoutSec 30).Content } catch {}
  $tag = switch ($c.expect) {
    'ok'      { if ($body.Trim() -eq 'ok') { 'OK' } else { 'BAD: ' + $body.Trim().Substring(0, [Math]::Min(40, $body.Trim().Length)) } }
    'null'    { if ($body.Trim() -eq 'null') { 'OK' } else { 'BAD: ' + $body.Trim().Substring(0, [Math]::Min(40, $body.Trim().Length)) } }
    'json'    { if ($body -match 'siteKey') { 'OK' } else { 'CHECK: ' + $body.Substring(0, [Math]::Min(60, $body.Length)) } }
    'sitemap' { if ($body -match 'sitemap') { 'OK' } else { 'BAD' } }
    '301'     { if ($code -eq 301) { 'OK 301' } else { "BAD $code" } }
    default   { if ($code -eq 200) { 'OK 200' } else { "BAD $code" } }
  }
  "{0,-55} {1}" -f $c.u, $tag
}
