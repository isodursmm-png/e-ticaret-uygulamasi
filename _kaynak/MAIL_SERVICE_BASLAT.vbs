' mail-service.js'yi penceresiz (arka planda, konsol penceresi açmadan) başlatır.
' "Grafiği gönder" özelliğinin otonom çalışması için bu dosyanın kısayolunu
' Windows Başlangıç klasörüne (Win+R -> shell:startup) koyun; böylece Windows
' her açıldığında servis kendiliğinden ayağa kalkar, elle "node ..." çalıştırmaya
' gerek kalmaz.
Set fso = CreateObject("Scripting.FileSystemObject")
kaynakDizini = fso.GetParentFolderName(WScript.ScriptFullName)
projeDizini = fso.GetParentFolderName(kaynakDizini)

Set sh = CreateObject("WScript.Shell")

' Zaten çalışıyorsa (bir önceki oturumdan kalmışsa) tekrar başlatma.
calisiyor = False
On Error Resume Next
Set http = CreateObject("Msxml2.XMLHTTP.6.0")
http.open "POST", "http://localhost:8788/gonder", False
http.send "{}"
If Err.Number = 0 Then calisiyor = True
On Error Goto 0

If Not calisiyor Then
    sh.CurrentDirectory = projeDizini
    sh.Run "node ""_kaynak\mail-service.js""", 0, False
End If
