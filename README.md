# MySemester

## Subject setup and student visibility

KO or a Class Admin can link a catalog subject to a semester and assign an active lecturer and PIC in **Tetapan Subjek**. The semester-subject link is stored in `SemesterSubjects` (`lecturer_user_id` and `pic_user_id`); schedules, PB and learning resources reference its `semester_subject_id`.

Students see a subject only after the mapping is active, both assigned staff are active class members with the matching roles, and the subject has an active class session or recurring schedule. Student dashboards list published PB only. PB instructions and supporting materials are linked through `AssignmentResources`.

PICs can view and manage only their assigned subjects. Lecturers can view and manage only their assigned subjects that have an active schedule. KO and Class Admin can manage subject staffing and class-wide schedules.

## Class, subject, and lecturer relationships

The canonical path is `Classes.class_id` → `Semesters.class_id` → `SemesterSubjects.semester_id` → `Subjects.subject_id`. `SemesterSubjects` is the semester-specific assignment bridge: its `lecturer_user_id` and `pic_user_id` reference `Users.user_id`, and each assigned staff member must also be an active `ClassMembers` entry for the same class with the matching role. Schedules, PB, and resources reference `semester_subject_id`, so they inherit the class, semester, and subject mapping without duplicating those IDs.

Do not add a second class-subject or lecturer-subject mapping table, or copy `class_id` onto `SemesterSubjects`; either would duplicate the canonical relationship and allow assignments to disagree with their semester. The workbook's `DataModel` sheet documents these keys and validation rules.

The Apps Script backend adds `pic_user_id` to existing `SemesterSubjects` sheets when the API is next used. Upload [MySemester_DB.xlsx](./MySemester_DB.xlsx) to Google Drive and set the spreadsheet ID in Apps Script before deploying.
