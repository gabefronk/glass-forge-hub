// Owner-supplied superintendent hints (2026-09-18). They are proposals only and are never written:
// a ContactJobLink exists only after the owner confirms a directory contact for the job.
// Backend-only: imported by the owner-gated contacts-directory function, never by src/.
export const CONTACT_LINK_SEEDS=[
 {
  id:'holmes-daybreak-towns-395-397-super',builder:'Holmes Homes',role:'superintendent',
  name:'Davis',name_variants:['davies','daviss'],name_verified:false,phone:'',
  label:'395-397 Daybreak Towns, 11354-11358 S Watercourse Rd, South Jordan',
  note:'Spelling unconfirmed (typed as "Dvais"). Match to a directory contact before linking.',
  job:{name_tokens:[['395','daybreak'],['397','daybreak']],address:{street:'watercourse',from:11354,to:11358}}
 },
 {
  id:'holmes-607-daybreak-move-up-super',builder:'Holmes Homes',role:'superintendent',
  name:'Makay',name_variants:['mckay','mackay'],name_verified:true,phone:'+18016966077',
  label:'607 Daybreak Move Up, 6847 W Ripple Rd',
  note:'Known-good superintendent from the owner.',
  job:{name_tokens:[['607','daybreak']],address:{street:'ripple',from:6847,to:6847}}
 }
];
