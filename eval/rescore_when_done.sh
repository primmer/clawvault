#!/bin/bash
# Wait for all v9 eval processes to finish, then re-score
source ~/.openclaw/.credentials.env
cd ~/clawvault/eval

echo "Waiting for v9 evals to complete..."
while pgrep -f "run_v9_eval" > /dev/null; do
    sleep 30
    echo "  $(date): $(wc -l results/v9-*-answers.jsonl | tail -1)"
done

echo "All evals complete. Running scorer..."
python3 -u score_v9_all.py 2>&1 | tee results/v9-final-scoring.log
echo "Done at $(date)"
