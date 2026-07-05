# @tlh/ui — design system (atomic)

Themeable (dark/light via `data-theme` + CSS vars from `@tlh/config` tokens), accessible
(Radix primitives), documented in Storybook. Atoms → molecules → organisms → templates
(see [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §5). Prices use tabular mono
figures; motion via Framer Motion. Consumed by `@tlh/web`.

Core atoms + tokens land in **M0**; organisms (OptionChainTable, PayoffChart, StrategyCanvas,
GreeksHeatmap, EquityCurve) arrive with their owning module.
