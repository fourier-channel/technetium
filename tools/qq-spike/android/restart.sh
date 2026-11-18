# Restart test: prove Chrome's process is gone, relaunch the spike page in a new process.
# Then read the page log over CDP for "queryPermission on load". adb push it and adb shell sh it.
echo "before: $(pidof com.android.chrome) at $(date +%T)"
am force-stop com.android.chrome
sleep 2
echo "after force-stop: [$(pidof com.android.chrome)] at $(date +%T)"
am start -a android.intent.action.VIEW -d http://localhost:5199/spike.html com.android.chrome > /dev/null
sleep 8
echo "relaunched: $(pidof com.android.chrome) at $(date +%T)"
for p in $(pidof com.android.chrome); do ps -o PID,STIME,NAME -p $p | tail -1; done
