# WorkManager's Room database is instantiated reflectively (Class.forName on WorkDatabase_Impl).
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }

# Workers are created reflectively by WorkManager's default WorkerFactory.
-keep class expo.modules.qashywidgets.** extends androidx.work.ListenableWorker {
  public <init>(android.content.Context, androidx.work.WorkerParameters);
}
