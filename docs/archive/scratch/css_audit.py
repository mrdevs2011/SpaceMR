import re,sys,collections,glob
files=['tokens.css','base.css','layers.css','features.css','mono-x.css','admin.css']
order=[l.strip() for l in open('scripts/build-css.mjs').read().split('\n') if '.css' in l]
print(order[:12],file=sys.stderr)
def parse(path):
    s=open(path).read()
    s=re.sub(r'/\*.*?\*/','',s,flags=re.S)
    out=[];stack=[];buf='';i=0
    ctx=[]
    for ch in s:
        if ch=='{':
            sel=buf.strip();buf=''
            stack.append(sel)
        elif ch=='}':
            if stack:
                stack.pop()
            buf=''
        elif ch==';' and stack and not stack[-1].startswith('@') :
            pass
        buf+=ch if ch not in '{}' else ''
        # collect declarations at close handled below
    return s
# simpler: regex rule blocks (no nested except @media)
def rules(path):
    s=open(path).read(); s=re.sub(r'/\*.*?\*/','',s,flags=re.S)
    res=[]; 
    pos=0; media=''
    stack=[]; 
    i=0;n=len(s);cur=''
    while i<n:
        c=s[i]
        if c=='{':
            head=cur.strip(); cur=''
            if head.startswith('@media') or head.startswith('@supports') or head.startswith('@layer'):
                stack.append(('at',head))
            elif head.startswith('@'):
                # keyframes/font-face: skip body
                depth=1;i+=1
                while i<n and depth: 
                    if s[i]=='{':depth+=1
                    elif s[i]=='}':depth-=1
                    i+=1
                continue
            else:
                j=s.index('}',i); body=s[i+1:j]; i=j
                ctxs=' | '.join(h for t,h in stack)
                for sel in head.split(','):
                    res.append((ctxs,' '.join(sel.split()),body))
        elif c=='}':
            if stack: stack.pop()
            cur=''
        else: cur+=c
        i+=1
    return res
decl=collections.defaultdict(list)
for f in files:
    for ctx,sel,body in rules('CSS/'+f):
        for d in body.split(';'):
            if ':' not in d: continue
            p,v=d.split(':',1); p=p.strip();v=' '.join(v.split())
            decl[(ctx,sel,p)].append((f,v))
conf=[(k,v) for k,v in decl.items() if len(v)>1 and len(set(x[1] for x in v))>1]
print(len(conf),'conflicting redeclarations')
imp=0
for k,v in conf:
    print(k[1][:70],'|',k[2],'|',k[0][:30],'=>',[ (f[:4],val[:28]) for f,val in v][:4])
