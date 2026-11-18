# Baseline with no Chrome and no SAF: the same files read by native processes through
# /sdcard (FUSE). Run on the tablet: adb push native.sh /data/local/tmp/ && adb shell sh /data/local/tmp/native.sh
# Subtract the fork-cost line from the header line to get the per-file open + read cost.
# Android sh (mksh) only: it uses time ( ... ), which dash and POSIX sh reject.
cd /sdcard/Pictures/qq-test/txt2img-images || { echo "FAIL: no test set at /sdcard/Pictures/qq-test. fix: adb push it there first"; exit 1; }
echo "files: $(ls */* | wc -l)"
echo "== header 64 KB each, one at a time (one head process per file)"
time (for f in */*; do head -c 65536 "$f" > /dev/null; done)
echo "== fork cost alone: head on /dev/zero, same count"
time (n=$(ls */* | wc -l); i=0; while [ $i -lt $n ]; do head -c 1 /dev/zero > /dev/null; i=$((i+1)); done)
echo "== full read + md5, all files, one stream"
time (cat */* | md5sum)
