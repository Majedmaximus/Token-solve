"""Post-deployment check for the public frontend only. No secrets or private source."""
import hashlib,json,os,time,tempfile,urllib.request,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
BASE='https://majedmaximus.github.io/Token-solve/'
expected=json.loads(Path('release-manifest.json').read_text())
def get(name):
    request=urllib.request.Request(BASE+name+'?release='+os.environ.get('GITHUB_SHA','check'),headers={'Cache-Control':'no-cache','User-Agent':'TRACE-public-smoke'})
    with urllib.request.urlopen(request,timeout=20) as r:
        target=urllib.parse.urlsplit(r.url)
        assert target.scheme=='https' and target.hostname=='majedmaximus.github.io'
        return r.read(),r.headers.get('Content-Type','')
for attempt in range(18):
    try:
        actual=json.loads(get('release-manifest.json')[0])
        assert actual==expected,'Pages still serves an earlier release'
        break
    except Exception:
        if attempt==17:raise
        time.sleep(10)
for item in expected['files']:
    name=item['path']
    if name in {'.nojekyll','_headers','launch/.nojekyll'}:continue  # deployment config, not a browser asset
    assert not name.startswith('/') and '..' not in name.split('/')
    data,mime=get(name)
    assert hashlib.sha256(data).hexdigest()==item['sha256'],name+' integrity mismatch'
    if name.endswith(('.mjs','.js')):assert 'javascript' in mime,name+' is not served as JavaScript'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':390,'height':844});errors=[];requests=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:requests.append(request.url))
    page.goto(BASE,wait_until='networkidle')
    expect(page.locator('#contact-save')).to_be_visible()
    page.get_by_role('button',name='Generate temporary identity').click()
    expect(page.locator('#sign')).to_be_enabled()
    fp=page.locator('#fingerprint code').inner_text()
    page.get_by_label('Recipient EVM address').fill('0x1111111111111111111111111111111111111111')
    page.get_by_label('Purpose',exact=True).fill('Automated no-funds deployment check')
    page.locator('#sign').click();expect(page.locator('#signed')).not_to_have_value('')
    envelope=json.loads(page.locator('#signed').input_value())
    page.locator('#expected').fill(fp);page.locator('#envelope').fill(json.dumps(envelope));page.locator('#verify').click()
    expect(page.locator('#result')).to_contain_text('Signature matches the expected key')
    with tempfile.TemporaryDirectory() as temporary:
        with page.expect_download() as download:
            page.locator('#download-request').click()
        exported=Path(temporary)/'signed-request.json'
        download.value.save_as(exported)
        recipient=browser.new_context(viewport={'width':390,'height':844}).new_page()
        recipient.on('pageerror',lambda error:errors.append(str(error)))
        recipient.on('request',lambda request:requests.append(request.url))
        recipient.goto(BASE,wait_until='networkidle')
        recipient.locator('#expected').fill(fp)
        recipient.locator('#import-request').set_input_files(exported)
        expect(recipient.locator('#result')).to_contain_text('Request imported')
        expect(recipient.locator('#expected')).to_have_value(fp)
        recipient.locator('#verify').click()
        expect(recipient.locator('#result')).to_contain_text('Signature matches the expected key')
        changed=json.loads(exported.read_text());changed['payload']['amount']='999'
        exported.write_text(json.dumps(changed))
        recipient.locator('#import-request').set_input_files(exported)
        expect(recipient.locator('#details')).to_have_text('')
        recipient.locator('#verify').click()
        expect(recipient.locator('#result')).to_contain_text('INVALID')
        recipient.locator('#import-request').set_input_files({'name':'large.json','mimeType':'application/json','buffer':b'x'*12001})
        expect(recipient.locator('#result')).to_contain_text('exceeds 12 KB')
        expect(recipient.locator('#envelope')).to_have_value('')
        expect(recipient.locator('#expected')).to_have_value(fp)
        recipient.locator('#import-request').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'<script>invalid</script>'})
        expect(recipient.locator('#result')).to_contain_text('Import rejected')
        assert recipient.evaluate('document.documentElement.scrollWidth <= innerWidth')
        recipient.context.close()
    envelope['payload']['amount']='999';page.locator('#envelope').fill(json.dumps(envelope));page.locator('#verify').click()
    expect(page.locator('#result')).to_contain_text('INVALID')
    page.goto(BASE+'launch/',wait_until='networkidle')
    expect(page.get_by_text('Public testnets only.',exact=True)).to_be_visible()
    page.locator('#connect').click()
    expect(page.locator('#status')).to_contain_text('EIP-1193 wallet')
    page.goto(BASE+'vault.html',wait_until='networkidle')
    page.locator('#encrypt').click()
    expect(page.locator('#status')).to_contain_text('اختر الملف')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors,errors
    assert all(urllib.parse.urlsplit(url).hostname=='majedmaximus.github.io' for url in requests),requests
    assert not any('/api/' in url for url in requests)
    browser.close()
summary='PASS: exported signed request imported and verified in an isolated browser; tampered, oversized and invalid files rejected; trusted fingerprint preserved. No payments or wallet transactions.'
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as report:report.write(summary+'\n')
print(summary)
print('PASS: actual HTTPS deployment matches release hashes; browser signing, tamper rejection, module MIME and mobile layout verified. No funds used.')
