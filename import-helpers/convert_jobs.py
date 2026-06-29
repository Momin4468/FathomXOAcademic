"""Convert your existing JOBS sheet into jobs-template.csv.
EDIT `MAPPING` to your source columns. python convert_jobs.py your_jobs.csv jobs.out.csv
"""
from _lib import run

HEADERS = ["title", "clientName", "courseCode", "assignmentType", "doerName", "details", "notes"]
MAPPING = {
    "title": "Assignment",
    "clientName": "Student Name",
    "courseCode": "Course",        # canonicalised on import (ICT 701 = ICT701 = 701)
    "assignmentType": "Type",
    "doerName": "Writer",
    "details": "Details",
    "notes": "Notes",
}

if __name__ == "__main__":
    run(HEADERS, MAPPING)
