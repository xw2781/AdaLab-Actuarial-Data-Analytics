
Option Private Module
Option Explicit

Public Const ADAS_VERSION As String = "2.1.0"

' User-specific config (C:\Users\...\AppData\Local\ADAS\config.txt)
Public configDir As String
Public configPath As String
Public removeData As Boolean
Public disable_ufLoading As Boolean
Public teamProfile As String
Public debugMode As Boolean
Public disableProgressBar As Boolean

' Internal Controls
Public disableRequest As Boolean
Public disableWaitTime As Boolean
Public skipDataProcess As Boolean
Public maxWaitTime As Single
Public errCount As Integer
Public lastRequestInfo As String

Public processedCells As New Collection
Public processedArrays As New Collection
Public cancelUpdate As Boolean
Public pendingUpdate As Boolean
Public doubleRefresh As Boolean
Public disableWatcher As Boolean

' UI Select Dataset
Public Const VP_SETTINGS_PATH As String = "E:\ADAS\Virtual Projects\ResQ - Channel.xlsx"
Public Const VP_SETTINGS_SHEET As String = "Dataset Types"

Public triangle_tool_row As Long
Public triangle_tool_col As Long

Public Function FirstExistingPath(ParamArray paths() As Variant) As String
    Dim i As Long
    For i = LBound(paths) To UBound(paths)
        If Len(Dir$(CStr(paths(i)), vbNormal Or vbReadOnly Or vbHidden Or vbSystem Or vbDirectory)) > 0 Then
            FirstExistingPath = CStr(paths(i))
            Exit Function
        End If
    Next i
    FirstExistingPath = CStr(paths(LBound(paths)))
End Function

Public Function ProductRootPath() As String
    ProductRootPath = FirstExistingPath("E:\ArcRho Server", "E:\ArcRho", "E:\ADAS")
End Function

Public Function ProductPath(ByVal relativePath As String) As String
    If Left$(relativePath, 1) = "\" Then relativePath = Mid$(relativePath, 2)
    ProductPath = ProductRootPath() & "\" & relativePath
End Function

Public Function VPSettingsPath() As String
    VPSettingsPath = FirstExistingPath( _
        ProductPath("Virtual Projects\ResQ - Channel.xlsx"), _
        "E:\ADAS\Virtual Projects\ResQ - Channel.xlsx")
End Function

Private Sub InitConfigPaths()
    configDir = Environ$("LOCALAPPDATA") & "\ADAS"
    configPath = configDir & "\config.txt"
End Sub

Public Function GetDataset(funcArgs As String)
' +---------------+
' | Main Function |
' +---------------+
    Dim dataPath As String
    Dim projectDataDir As String
    Dim t1 As Double, t2 As Double
    Dim requestInfo As String
    Const MAX_WAIT_SEC As Double = 5
    On Error GoTo ErrHandler
    
    If skipDataProcess Then
        Exit Function
    End If
    
    ' t1 = Timer
    ' Debug.Print "Time - Start: " & TimeMS()
    
    dataPath = SetDataPath(funcArgs)
    If InStrRev(dataPath, "\") > 0 Then
        projectDataDir = Left$(dataPath, InStrRev(dataPath, "\") - 1)
        If Dir(projectDataDir, vbDirectory) = "" Then
            EnsureFolderPath projectDataDir
        End If
    End If
    requestInfo = funcArgs & "#DataPath = " & dataPath
    
    ' --- Case 1: reuse existing data if allowed ---
    If (Dir(dataPath) <> "") And (removeData = False) Then
        GetDataset = GetDataArray(dataPath)
        errCount = 0
        GoTo CleanExit
    End If
    
    ' --- Case 2: need fresh data ---
    ufLoading.UpdateText "Updating [" & GetParamValue(requestInfo, "DatasetName") & "]"
    
    If Dir(dataPath) <> "" Then
        Kill dataPath
    End If
    
    ' Send Request
    SendRequest requestInfo
    doubleRefresh = True
    
    ' Waiting for data...
    If disableWaitTime Then
        GetDataset = "(waiting for data)"
        Exit Function
    End If
    
    If Not WaitForFileReady(dataPath, MAX_WAIT_SEC) Then
        GetDataset = "request time out"
        GoTo CleanExit
    End If
    
    ' t2 = Timer
    ' Debug.Print "Time - End  : " & TimeMS()
    ' Debug.Print "Time - Spent: " & Format(t2 - t1, "0.000")
    
    If Dir(dataPath) <> "" Then
        GetDataset = GetDataArray(dataPath)
    Else
        Debug.Print "[error] - data path not found"
        GetDataset = "data path not found"
        GoTo CleanExit
    End If
    
    errCount = 0

CleanExit:
    Unload ufLoading
    ufLoading.Reset
    Exit Function
    
ErrHandler:
    Debug.Print "GetDataset error: "; Err.Number; Err.Description
    Resume CleanExit

End Function


Private Sub EnsureFolderPath(ByVal folderPath As String)
    Dim parts() As String
    Dim currentPath As String
    Dim i As Long

    If Len(Trim$(folderPath)) = 0 Then Exit Sub
    If Dir(folderPath, vbDirectory) <> "" Then Exit Sub

    parts = Split(folderPath, "\")
    If UBound(parts) < 0 Then Exit Sub

    If Left$(folderPath, 2) = "\\" Then
        If UBound(parts) < 3 Then Exit Sub
        currentPath = "\\" & parts(2) & "\" & parts(3)
        i = 4
    Else
        currentPath = parts(0)
        i = 1
    End If

    For i = i To UBound(parts)
        If Len(parts(i)) > 0 Then
            currentPath = currentPath & "\" & parts(i)
            If Dir(currentPath, vbDirectory) = "" Then MkDir currentPath
        End If
    Next i
End Sub

Public Sub LoadConfig()
    Dim line As String, parts As Variant
    Dim fileVersion As String
    Dim f As Integer

    InitConfigPaths

    ' Ensure config dir
    If Dir(configDir, vbDirectory) = "" Then
        MkDir configDir
    End If

    ' -------------------------
    ' Check existing config version
    ' -------------------------
    If Dir(configPath) <> "" Then
        f = FreeFile
        Open configPath For Input As #f

        Do While Not EOF(f)
            Line Input #f, line
            line = Trim$(line)

            If InStr(line, "=") > 0 Then
                parts = Split(line, "=")
                If LCase$(Trim$(parts(0))) = "version" Then
                    fileVersion = Trim$(parts(1))
                    Exit Do
                End If
            End If
        Loop

        Close #f

        ' Version mismatch ? delete config
        If fileVersion <> ADAS_VERSION Then
            Kill configPath
        End If
    End If

    ' -------------------------
    ' Create config if missing
    ' -------------------------
    If Dir(configPath) = "" Then
        f = FreeFile
        Open configPath For Output As #f
        Print #f, "version = " & ADAS_VERSION
        Print #f, "removeData = False"
        Print #f, "disable_ufLoading = False"
        Print #f, "teamProfile = Default"
        Print #f, "debugMode = False"
        Print #f, "disableProgressBar = False"
        Close #f
    End If

    ' -------------------------
    ' Load config values
    ' -------------------------
    f = FreeFile
    Open configPath For Input As #f

    Do While Not EOF(f)
        Line Input #f, line
        line = Trim$(line)

        If InStr(line, "=") > 0 Then
            parts = Split(line, "=")

            Select Case LCase$(Trim$(parts(0)))
                Case "version"
                    ' ignore, already handled

                Case "removedata"
                    removeData = CBool(Trim$(parts(1)))

                Case "disable_ufLoading", "disable_ufLoading"
                    disable_ufLoading = CBool(Trim$(parts(1)))

                Case "teamprofile"
                    teamProfile = Trim$(parts(1))
                    
                Case "debugMode"
                    debugMode = CBool(Trim$(parts(1)))
                    
                Case "disableProgressBar"
                    disableProgressBar = CBool(Trim$(parts(1)))
                    
            End Select
        End If
    Loop

    Close #f
   
End Sub

Public Sub UpdateConfigValue(ByVal keyName As String, ByVal newValue As String)
    Dim lines() As String, temp As String
    Dim f As Integer, i As Long

    InitConfigPaths

    ' Read all lines
    f = FreeFile()
    Open configPath For Input As #f
    lines = Split(Input$(LOF(f), f), vbCrLf)
    Close #f

    ' Modify the specific key
    For i = LBound(lines) To UBound(lines)
        temp = Trim(lines(i))
        If InStr(temp, "=") > 0 Then
            If LCase$(Trim$(Split(temp, "=")(0))) = LCase$(keyName) Then
                lines(i) = keyName & " = " & newValue
            End If
        End If
    Next i

    ' Rewrite file
    f = FreeFile()
    Open configPath For Output As #f
    For i = LBound(lines) To UBound(lines)
        Print #f, lines(i)
    Next i
    Close #f
End Sub

Public Function SetDataPath(inputString As String) As String
    Dim s As String, proj As String
    Dim lines() As String, parts() As String
    Dim i As Long
    Dim key As String, val As String
    Dim fullName As String
    Dim basePath As String
    Dim functionName As String
    Dim reservingClassPath As String
    Dim datasetName As String
    Dim projectDataPath As String
    Dim rcFolder As String
    Dim datasetFile As String
    
    ' Normalize delimiters: allow either "#" or newlines between pairs
    s = inputString
    s = Replace(s, vbCrLf, "#")
    s = Replace(s, vbCr, "#")
    s = Replace(s, vbLf, "#")
    lines = Split(s, "#")
    
    ' Build the @-joined Value list for legacy flat caches while also capturing
    ' the project, reserving class path, and dataset name for the new ArcRho
    ' project data layout.
    For i = LBound(lines) To UBound(lines)
        If Len(Trim$(lines(i))) > 0 Then
            If InStr(1, lines(i), "=", vbTextCompare) > 0 Then
                parts = Split(lines(i), "=")
                key = Trim$(parts(0))
                val = Trim$(Mid$(lines(i), InStr(1, lines(i), "=", vbTextCompare) + 1))
                
                Select Case LCase$(key)
                    Case "projectname"
                        proj = val
                    Case "function"
                        functionName = val
                        If Len(fullName) > 0 Then fullName = fullName & "@"
                        fullName = fullName & val
                    Case "path"
                        reservingClassPath = val
                        If Len(fullName) > 0 Then fullName = fullName & "@"
                        fullName = fullName & val
                    Case "datasetname", "trianglename"
                        datasetName = val
                        If Len(fullName) > 0 Then fullName = fullName & "@"
                        fullName = fullName & val
                    Case Else
                        If Len(fullName) > 0 Then fullName = fullName & "@"
                        fullName = fullName & val
                End Select
            End If
        End If
    Next i
    
    basePath = ProductPath("projects\")
    
    If Len(proj) > 0 Then
        proj = SanitizeProjectFolderName(proj)
        projectDataPath = basePath & proj & "\data"
    Else
        projectDataPath = basePath & "data"
    End If

    ' New storage contract: dataset CSV files live under one sanitized
    ' reserving-class folder and no longer repeat the reserving class path in
    ' the filename.
    If Len(reservingClassPath) > 0 And Len(datasetName) > 0 Then
        rcFolder = SanitizeReservingClassFolderName(reservingClassPath)
        datasetFile = SanitizeDataFileName(datasetName)
        SetDataPath = projectDataPath & "\" & rcFolder & "\" & datasetFile & ".csv"
        Exit Function
    End If

    ' Legacy fallback for requests that are not scoped by reserving class and
    ' dataset name, such as ArcRhoHeaders.
    fullName = Replace(fullName, "\", "^")
    fullName = Replace(fullName, "/", "^")
    fullName = Replace(fullName, "*", "$star$")
    SetDataPath = projectDataPath & "\" & fullName & ".csv"
End Function

Private Function SanitizeProjectFolderName(ByVal value As String) As String
    Dim invalidChars As Variant, ch As Variant
    SanitizeProjectFolderName = Trim$(value)
    invalidChars = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    For Each ch In invalidChars
        SanitizeProjectFolderName = Replace(SanitizeProjectFolderName, CStr(ch), "_")
    Next ch
End Function

Private Function SanitizeReservingClassFolderName(ByVal value As String) As String
    Dim invalidChars As Variant, ch As Variant
    SanitizeReservingClassFolderName = Trim$(value)
    invalidChars = Array("<", ">", ":", """", "/", "\", "|", "?", "*")
    For Each ch In invalidChars
        SanitizeReservingClassFolderName = Replace(SanitizeReservingClassFolderName, CStr(ch), "^")
    Next ch
    Do While Right$(SanitizeReservingClassFolderName, 1) = " " Or Right$(SanitizeReservingClassFolderName, 1) = "."
        SanitizeReservingClassFolderName = Left$(SanitizeReservingClassFolderName, Len(SanitizeReservingClassFolderName) - 1) & "^"
    Loop
    If Len(SanitizeReservingClassFolderName) = 0 Then SanitizeReservingClassFolderName = "ReservingClass"
End Function

Private Function SanitizeDataFileName(ByVal value As String) As String
    Dim invalidChars As Variant, ch As Variant
    SanitizeDataFileName = Trim$(value)
    invalidChars = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    For Each ch In invalidChars
        SanitizeDataFileName = Replace(SanitizeDataFileName, CStr(ch), "_")
    Next ch
    If Len(SanitizeDataFileName) = 0 Then SanitizeDataFileName = "Dataset"
End Function

Public Function SetDefaultProject(ByVal ProjectName As String)
    Dim tmpName As String
    ' SetProjectName
    If ProjectName = "Default" Then
        tmpName = ActiveWorkbook.Sheets("ResQ Settings").Range("B7").Value
    Else
        tmpName = ProjectName
    End If
    SetDefaultProject = Mid(tmpName, InStrRev(tmpName, "\") + 1)
End Function

Public Sub SendRequest(requestInfo As String)
    Dim lines() As String
    Dim aFile As Integer
    Dim currentTime As String
    Dim tempPath As String, finalPath As String
    Dim i As Long

    If disableRequest Then Exit Sub

    lines = Split(requestInfo, "#")

    currentTime = Format(Now, "yyyy-mm-dd_hh-mm-ss") & Format(Timer - Int(Timer), ".000")
    If Dir(ProductPath("requests"), vbDirectory) = "" Then MkDir ProductPath("requests")

    tempPath = ProductPath("requests\request-" & currentTime & ".tmp")
    finalPath = ProductPath("requests\request-" & currentTime & ".txt")

    aFile = FreeFile
    Open tempPath For Output As #aFile
        For i = LBound(lines) To UBound(lines)
            Print #aFile, lines(i)
        Next
        Print #aFile, "UserName = " & Environ$("USERNAME")
    Close #aFile

    ' --- overwrite protection ---
    If Dir(finalPath, vbNormal) <> "" Then
        On Error Resume Next
        Kill finalPath
        If Err.Number <> 0 Then
            Err.Clear
            On Error GoTo 0
            Kill tempPath     ' cleanup temp
            Exit Sub          ' abort safely
        End If
        On Error GoTo 0
    End If

    ' --- atomic publish ---
    Name tempPath As finalPath
End Sub

Public Function GetDataArray(dataPath As String)
' *----------------------------------------------*
' | Get the data array from an external csv file |
' *----------------------------------------------*
    Dim outputArray() As Variant
    Dim lines() As String
    Dim aFile As Integer
    Dim dateTimeString As String
    Dim data() As String
    Dim fileContent As String
    Dim i As Long, j As Long
    
    aFile = FreeFile
    Open dataPath For Input As #aFile
    fileContent = Input$(LOF(aFile), #aFile)
    Close #aFile

    lines = Split(fileContent, vbCrLf)
    ReDim outputArray(LBound(lines) To UBound(lines) - 1, 0)
    
    For i = LBound(lines) To UBound(lines) - 1
        data = Split(lines(i), ",")
        If UBound(data) > UBound(outputArray, 2) Then
            ReDim Preserve outputArray(LBound(lines) To UBound(lines) - 1, LBound(data) To UBound(data))
        End If
        For j = LBound(data) To UBound(data)
     
            dateTimeString = data(j)
            If InStr(dateTimeString, "+") > 0 Then
                dateTimeString = Left(dateTimeString, InStr(dateTimeString, "+") - 1)
            End If
            
            If IsNumeric(data(j)) Then
                outputArray(i, j) = CDbl(data(j))
            ElseIf IsDate(dateTimeString) Then
                outputArray(i, j) = CDbl(CDate(dateTimeString))
            Else
                outputArray(i, j) = data(j)
            End If
        Next j
    Next i
    
    GetDataArray = outputArray
End Function




