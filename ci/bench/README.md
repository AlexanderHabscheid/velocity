# Benchmark Certification Baseline

`baseline-report.json` is the reference report used by:

```bash
npm run bench:certify
```

To refresh the baseline after an approved performance change:

1. Run `npm run build`
2. Run `node dist/cli.js bench-ci --profiles all --repeats 5 --seed 42 --out-dir ci/bench --fail-on-regression`
3. Replace `ci/bench/baseline-report.json` with the generated `ci/bench/velocity-bench-*.json` file from step 2
4. Re-run `npm run bench:certify`

Only update baseline in the same change where you document why the performance profile changed.

Current calibration note:
- CI now enforces latency plus byte-reduction floors. Frame reduction remains tracked for visibility but is not a strict gate.
