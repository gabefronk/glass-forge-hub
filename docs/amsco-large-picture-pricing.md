# Studio Direct Set large-picture pricing evidence

Scope: rectangular Studio Direct Set / Picture, Complete Unit, fixed operation, white/white, CozE (LowE), 3/4-inch insulated, non-tempered, automatic minimum glass, no grilles or optional glass upgrades. Reported example: 60 × 96 inches call size. This supports a narrow source-pricing coverage extension, not every product, glass package, shape, or large window.

## Finding

The app's previous 36-square-foot cap is below the native glass-filter threshold for this configuration. Native PK361 rules retain **3/16-inch over 3/16-inch** through **48 square feet of glass area**, inclusive, with each glass dimension no greater than 120 inches. Automatic minimum thickness has no separate thickness surcharge on this standard configuration.

For the reported example:

- Frame: 59.5 × 95.5 inches, area 39.460069 square feet.
- Pane: **57.8125 × 93.8125 inches**, area **37.6634385851 square feet**.
- Native minimum glass: **3/16-inch over 3/16-inch**.
- Native dimensional base cell: PriceBook 1, `Studio Direct Set PW Base`, WIDTH 60, HEIGHT 96, ID `afb1f5e9-6e58-4c23-9c41-de3865af34ba`, stored float price `842.400024414062` (currency $842.40). Preserve existing source-engine discount and customer-margin rules; this cell alone is not a universal quote.

## Manufacturer source rows

Read-only PK361 database queries are preserved as SQL and JSON in this directory.

`LimitationValues` rows **4761–4764**, joined to `Limitations`, identify SeriesID 31 / ProductTypeID 1 / ShapeID 1 / BaseProductTypeID 1 / ProductConfigurationID 0:

- 4761: Min Frame Width 8.
- 4762: Max Frame Width 120.
- 4763: Min Frame Height 8.
- 4764: Max Frame Height 120.

External-user equivalents 4767–4770 have the same width/height values. Applicable Series31/ProductType1, shape 0 or 1, configuration 0 rows contain no Max Frame Area or Max Glass Area row. This limited query does not prove the absence of every rule-based limitation. **48 square feet is specifically the native 3/16 glass filtering boundary, not a substituted global frame-area limit.**

`DrawingOffsets` rows **470–472, 475–476** provide 0.84375-inch head/sill/side glass offsets, giving 1.6875 inches total deduction per axis. `Windows` names confirm 100031 = Studio and 200001 = DirectSet.

## Native rule trace

IL offsets below are decimal byte offsets in the named PK361 method.

1. **PK105 WindowQuestionFiltering_S1, RID31, offsets2571–2606** invokes R1473 for Unit Type other than Glass Only. DP50 uses additional rule R5229, outside this scope.
2. **PK105 WindowQuestionFiltering_R1473, RID33** filters the window glass answer list. SS is filtered beyond66 inches or15sqft; DS beyond84 inches or25sqft. Offsets2315–2529 filter 3/16-over-3/16 only beyond120 inches or48sqft (or incompatible dual insulation). It remains visible at the reported size.
3. **PK105 WindowQuestionFiltering_R413, RID44, offsets1868–2114** applies the corresponding pane answer filter: width/height greater than120 or exact pane area greater than6912in² (=48sqft), or incompatible dual insulation, hides3/16-over-3/16. Comparisons are strict greater-than.
4. Database `Answers.AnswerOrder` for Glass Thickness Configuration orders SS/SS100, SS/DS200, DS/DS300, **3/16-over-3/16400**, then mixed options and1/4-over-1/4900. Thus3/16 is the first surviving standard answer for this pane.
5. **PK210 CustomAction, RID31, Keep Minimum Glass branch118293–124788**: offsets119907–120057 and120107–120268 enumerate answers, select the first visible answer, and stop. It therefore uses3/16 automatically.
6. **PK135 GeneratePriceMods_PB1_S18, RID38, offsets12572–12877**, rule2714: ordinary thickness add-on requires Keep Minimum Glass Thickness=No and custom condition Not Default Glass Thickness. **PK235 CustomCondition, RID24, offsets11400–11805** compares current thickness to the first visible answer and returns false when equal. Its separate CozE Max exception does not apply to CozE LowE. Automatic3/16 incurs no added thickness charge.
7. **PK135 GeneratePriceMods_PB1_S5, RID25, offsets3876–3953**, rule782 sets Base Price from Studio Direct Set PW Base dimensional lookup.
8. PK135 PB1_S18 and PB1_S19 normalized native IL compared identical between staged PK358 and PK361. Readable equivalent: `C:/AmscoAnalysis/FinalExtraction/06_Pricing_Engine/_decompiled/PB1_all_clean.cs`, especially lines7905–7942. PK361 IL itself is preserved in `pk361-large-glass-il-evidence.json`.

## Independent boundary checks

`verify-large-glass-native-il.py` interprets actual PK361 R1473 and R413 method bodies with the existing static CLI metadata reader. It does not import app JavaScript or duplicate the app threshold function. It reads native answer order from the DB query. `pk361-large-glass-filter-vectors.json` contains nine vectors:

- Reported pane, exact36sqft, just above36sqft, exact48sqft, and120-inch glass dimension:3/16 retained.
- Just above48sqft or120 inches:3/16 filtered.
- Exact25sqft:DS retained; just above25sqft:DS filtered and3/16 first.

This harness isolates two native size filters; it does not execute every native rating, structural, configuration, or pricing rule. Keep the extension scoped to the previously supported standard Studio Direct Set path and keep other existing coverage guards.

## Source identity

Staged source root: `C:/Users/Owner/Documents/Codex/2026-09-10/realtime-voice-chat/work/transfer_stage/AMSCO_Base44_Engine_Transfer_2026-09-10/06_Vendor_Offline_Reference/AmscoNavigator/Configurators/PP/PP1/pk361/Navigator20Template`.

SHA-256:

- paradigmplus.db3: `5378b7c6b885e1cccd5201cac0b58e759f487e46a3721decc42ee9aa9e4ef046`
- library/Navigator20Template.PK105.361.dll: `b878d9170311a0e5ec0f0fb55cf3d54b380043921bc435f8c6006561dc1fad8b`
- library/Navigator20Template.PK210.361.dll: `031266c33ad10db1eeadffa2821ca148175168bd6b38f4467ec55a8dea303099`
- library/Navigator20Template.PK135.361.dll: `0cbaed395c5c454bd33efcc8f2ccb4f2f438666a47d44a34de8255956a76b42a`
- library/Navigator20Template.PK235.361.dll: `9c3e981fef270f0a4ba2fe0162cdb85f45480084a1407ed1361c3d560f0be271`

