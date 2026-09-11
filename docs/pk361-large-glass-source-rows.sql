SELECT v.*, l.BackendName, l.LimitationType, l.UserType FROM LimitationValues v LEFT JOIN Limitations l ON l.ID=v.LimitationID WHERE v.SeriesID IN (0,31) AND v.ProductTypeID IN (0,1) AND v.ShapeID IN (0,1) AND v.BaseProductTypeID IN (0,1) AND v.ProductConfigurationID=0 ORDER BY v.ID
;;;
SELECT d.*, t.BackendName FROM DrawingOffsets d LEFT JOIN DrawingOffsetTypes t ON t.ID=d.OffsetTypeID WHERE d.SeriesID IN (0,31) AND d.ProductTypeID IN (0,1) AND d.ShapeID IN (0,1) AND d.BaseProductTypeID IN (0,1) AND d.ProductConfigurationID=0 ORDER BY d.ID
;;;
SELECT * FROM Attributes WHERE GroupID=6 AND (Attr1 LIKE '%Studio%' OR Attr2 LIKE '%Studio%' OR Attr3 LIKE '%Studio%')
