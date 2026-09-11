import pathlib,ast,struct,json
root=pathlib.Path(r'C:\Users\Owner\Documents\Codex\2026-09-10\realtime-voice-chat\work\transfer_stage\AMSCO_Base44_Engine_Transfer_2026-09-10'); p=root/'08_Read_Only_Tools/static_runtime_inventory.py'; tree=ast.parse(p.read_text()); keep=[]
for n in tree.body:
 if isinstance(n,(ast.Import,ast.ImportFrom,ast.ClassDef)) or isinstance(n,ast.FunctionDef) and n.name=='ilrefs':keep.append(n)
 if isinstance(n,ast.Assign) and all(isinstance(t,ast.Name) and t.id in ['ONE4','ONE1','TWO4','TWO2','TWO1','TOKENS'] for t in n.targets):keep.append(n)
exec(compile(ast.Module(body=keep,type_ignores=[]),str(p),'exec'))
lib=root/'06_Vendor_Offline_Reference/AmscoNavigator/Configurators/PP/PP1/pk361/Navigator20Template/library'
def instructions(cli,rid):
 body=cli.body(rid);q=0;out=[]
 while q<len(body):
  start=q;op=body[q];q+=1;x=None
  if op==0xfe:x=body[q];q+=1;n=4 if x in TWO4 else 2 if x in TWO2 else 1 if x in TWO1 else 0
  elif op==0x45:n=4+4*int.from_bytes(body[q:q+4],'little')
  else:n=4 if op in ONE4 else 1 if op in ONE1 else 8 if op in(0x21,0x23)else 0
  val=body[q:q+n];q+=n;label=hex(op);v=val.hex()
  if x is not None:label={1:'ceq',2:'cgt',3:'cgt.un',4:'clt',5:'clt.un',9:'ldarg',11:'starg',12:'ldloc',14:'stloc'}.get(x,'fe '+hex(x))
  if op in TOKENS:label={0x7b:'ldfld',0x7d:'stfld',0x72:'ldstr',0x28:'call',0x6f:'callvirt'}.get(op,hex(op));v=cli.member(int.from_bytes(val,'little'))
  elif op==0x22:label='ldc.r4';v=struct.unpack('<f',val)[0]
  elif op==0x20:label='ldc.i4';v=int.from_bytes(val,'little',signed=True)
  elif 0x2b<=op<=0x44:label=['br','brfalse','brtrue','beq','bge','bgt','ble','blt','bne.un','bge.un','bgt.un','ble.un','blt.un'][(op-0x2b)%13];v=q+int.from_bytes(val,'little',signed=True)
  elif 0x16<=op<=0x1e:label='ldc.i4';v=op-0x16
  elif 2<=op<=5:label='ldarg';v=op-2
  elif 6<=op<=9:label='ldloc';v=op-6
  elif 10<=op<=13:label='stloc';v=op-10
  elif op in [0x11,0x13]:label='ldloc' if op==0x11 else 'stloc';v=int.from_bytes(val,'little')
  out.append([start,label,v])
 return out

def execute_filter(cli,rid,w,h,question):
 f32=lambda n:struct.unpack('<f',struct.pack('<f',n))[0]
 area_in=f32(f32(w)*f32(h)); area_ft=f32(area_in/144)
 fields={'WindowInfo_WNF::DV61_GlassWidthValue':f32(w),'WindowInfo_WNF::DV62_GlassHeightValue':f32(h),
 'WindowInfo_WNF::QV63_HiddenQuestions_GlassAreaFloatValue':area_ft,
 'WindowInfo_WNF::QV64_HiddenQuestions_VentGlassAreaFloatValue':0.,
 'WindowInfo_WNF::QV65_HiddenQuestions_DeadliteGlassAreaFloatValue':area_ft,
 'WindowInfo_WNF::QV66_Glass_GlazingMethodAnswer':'3/4" Insulated',
 'WindowInfo_WNF::QV70_Glass_TemperedAnswer':'No',
 'WindowInfo_WNF::Q2_Glass_GlassThickness':question,
 'WindowInfo_WNF::Q3_Glass_GlassThicknessConfiguration':question,
 'WindowInfo_WNF::CCNotSet98_ExactGlassArea':False,
 'WindowInfo_WNF::CC98_ExactGlassArea':area_in,'WindowInfo_WNF::iSUType':1}
 rows=instructions(cli,rid);indexes={r[0]:i for i,r in enumerate(rows)}; stack=[]; locs={};pc=0;steps=0
 while pc<len(rows):
  steps+=1
  if steps>20000:raise RuntimeError('step limit')
  offset,op,v=rows[pc];pc+=1
  if op in ['ldc.i4','ldc.r4','ldstr']:stack.append(v)
  elif op=='ldarg':stack.append(fields if v==3 else {'app':True})
  elif op=='ldfld':stack.pop();stack.append(fields[v])
  elif op=='stfld':a=stack.pop();stack.pop();fields[v]=a
  elif op=='ldloc':stack.append(locs[v])
  elif op=='stloc':locs[v]=stack.pop()
  elif op in ['ceq','cgt','clt','cgt.un','clt.un']:
   b=stack.pop();a=stack.pop();stack.append(int(a==b if op=='ceq' else a>b if op.startswith('cgt') else a<b))
  elif op=='br':pc=indexes[v]
  elif op in ['brfalse','brtrue']:
   a=stack.pop()
   if bool(a)==(op=='brtrue'):pc=indexes[v]
  elif op in ['beq','bne.un','bge','bgt','ble','blt','bge.un','bgt.un','ble.un','blt.un']:
   b=stack.pop();a=stack.pop();ok={'beq':a==b,'bne':a!=b,'bge':a>=b,'bgt':a>b,'ble':a<=b,'blt':a<b}[op.split('.')[0]]
   if ok:pc=indexes[v]
  elif op in ['call','callvirt']:
   if v.endswith('::CompareString'):
    ignorecase=stack.pop();b=stack.pop();a=stack.pop();stack.append((a>b)-(a<b))
   elif v.endswith('Question::get_Answers'):pass
   elif v.endswith('AnswerList::SetVisible'):
    name=stack.pop();vis=stack.pop();answers=stack.pop();answers[name]=bool(vis);stack.append(True)
   elif v.endswith('::get_ParadigmPlusAppConfig'):stack.pop();stack.append({'app':True})
   elif v.endswith('::LateGet'):
    for _ in range(7):stack.pop()
    stack.append(False)
   elif v.endswith('::ToBoolean'):stack.append(bool(stack.pop()))
   else:raise RuntimeError((offset,op,v))
  elif op=='0x8d':n=stack.pop();stack.append([None]*n)
  elif op=='0x14':stack.append(None)
  elif op=='0x26':stack.pop()
  elif op=='0x2a':return question
  else:raise RuntimeError((offset,op,v))
 return question
cli=CLI(lib/'Navigator20Template.PK105.361.dll')
answers=json.loads((pathlib.Path(__file__).parent/'pk361-large-glass-answer-order.json').read_text())['results'][1]['rows']
ordering=[r['BackendName'] for r in answers if r['QuestionName']=='Glass Thickness Configuration']
vectors=[]
for label,w,h in [
 ('reported_60x96_call',57.8125,93.8125),
 ('pane_36sqft',72,72),
 ('pane_just_over_36sqft',72.001,72),
 ('pane_48sqft',72,96),
 ('pane_just_over_48sqft',72.001,96),
 ('pane_max_dimension_120',57.6,120),
 ('pane_over_max_dimension_120',57.6,120.001),
 ('DS_boundary_25sqft',60,60),
 ('past_DS_boundary_25sqft',60.001,60)]:
 row={'label':label,'glass_width':w,'glass_height':h,'glass_area_sqft':w*h/144}
 for method,rid in [('window_R1473',33),('pane_R413',44)]:
  vis={name:True for name in ordering};execute_filter(cli,rid,w,h,vis)
  row[method]={'3/16_visible':vis['3/16" over 3/16"'],'SS_visible':vis['SS over SS'],'DS_visible':vis['DS over DS'],'first_surviving_answer':next((n for n in ordering if vis[n]),None)}
 vectors.append(row)
out={'scope':'Independent IL interpreter of native PK361 R1473 and R413 only. Full configuration validity and unrelated answer filtering are outside this fixture. No app JavaScript imported. Float comparisons mirror DLL single precision fields.','source_dll':str(cli.path),'sha256':hashlib.sha256(cli.path.read_bytes()).hexdigest(),'vectors':vectors}
dest=pathlib.Path(__file__).parent/'pk361-large-glass-filter-vectors.json';dest.write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))

